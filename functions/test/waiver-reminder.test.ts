/**
 * The waiver reminder the day before a trip: who gets one, once per
 * departure, and what a bounce of it (or of a signer's copy) sets off.
 * Against in-memory stand-ins for Firestore and email. Run with `npm test`
 * in functions/.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

process.env.APP_BASE_URL = 'https://example.com';

import { findWaiverReminderCandidates, sendWaiverReminder, type ReminderMailer } from '../src/waiverReminder';
import { processResendEvent, type BounceAlert } from '../src/lib/email-events';
import { fixBouncedEmail, type ResendPaths } from '../src/lib/fix-bounced-email';
import { TOKEN, fakeDb, type Doc } from './fakes';

// 3:00 PM at the marina (EST) on Sunday, November 8, 2026.
const NOW = new Date('2026-11-08T20:00:00Z');
const TRIP = '2026-11-09';
const sentAt = { toMillis: () => NOW.getTime() - 7 * 24 * 3600 * 1000 };

const base: Doc = {
  tourId: 'morning-shared',
  tourName: '2hr Morning Tour — Shared',
  date: TRIP,
  timeSlot: 'morning',
  type: 'shared',
  guestCount: 2,
  guests: [],
  customerName: 'Pat Example',
  customerEmail: 'pat@example.com',
  customerPhone: '352-555-0100',
  accessToken: TOKEN,
  status: 'confirmed',
  paymentStatus: 'paid',
  amountPaidCents: 16800,
  amountRefundedCents: 0,
};

/** Imported from the old site, as scripts/import-legacy-bookings.ts files it. */
const oldSite = (oldStatus: string): Doc => ({
  ...base,
  status: 'pending-payment',
  legacy: { bookingId: 1, oldStatus },
});

/** An old-site order nobody paid: the importer files it as cancelled. */
const oldSiteUnpaid: Doc = {
  ...oldSite('pending payment'),
  status: 'cancelled',
  paymentStatus: 'pending',
  amountPaidCents: 0,
  cancellationReason: 'Not paid on the old site',
};

function setup(
  bookings: Record<string, Doc>,
  waivers: Record<string, Doc> = {},
  blackouts: Array<Record<string, unknown>> = [],
) {
  const fake = fakeDb(bookings, { others: { waivers }, blackouts });
  const sent: Array<{ bookingId: string; to: string; subject: string; text: string; idempotencyKey?: string }> = [];
  const mail: ReminderMailer = async ({ bookingId, to, subject, text, idempotencyKey }) => {
    sent.push({ bookingId, to, subject, text, idempotencyKey });
    return `em_${sent.length}`;
  };
  const send = (id: string, force = false) => sendWaiverReminder(id, { db: fake.db, now: NOW, mail, force });
  return { ...fake, sent, mail, send };
}

describe('who gets a waiver reminder', () => {
  test('tomorrow’s trips still to sign, old-site reservations included; not checkouts, closed or reminded ones', async () => {
    const s = setup(
      {
        confirmed: { ...base },
        'legacy-1': oldSite('reserved'),
        // Part paid on the old site, still to pay the rest: going ahead.
        'legacy-2': oldSite('pending payment'),
        'legacy-3': oldSiteUnpaid,
        checkout: { ...base, status: 'pending-payment' },
        closed: { ...base, closure: { blackoutId: 'bo1', reason: 'Closed for weather', decideBy: '2026-11-12' } },
        reminded: { ...base, waiverReminderSentAt: sentAt, waiverReminderSentFor: `${TRIP}/morning` },
        moved: { ...base, waiverReminderSentAt: sentAt, waiverReminderSentFor: '2026-11-02/morning' },
        // Reminded before the departure was recorded: counts for this one.
        remindedBefore: { ...base, waiverReminderSentAt: sentAt },
        signed: { ...base, guestCount: 1 },
      },
      {
        w1: { bookingId: 'signed', signer: { name: 'Pat Example', participating: true, rosterName: null }, minors: [] },
      },
    );
    const due = await findWaiverReminderCandidates(TRIP, s.db);
    assert.deepEqual(due.sort(), ['confirmed', 'legacy-1', 'legacy-2', 'moved']);
  });

  test('the button reminds an old-site reservation, but not an unpaid old-site booking', async () => {
    const s = setup({ 'legacy-1': oldSite('reserved'), 'legacy-2': oldSite('pending payment'), 'legacy-3': oldSiteUnpaid });
    assert.deepEqual(await s.send('legacy-1', true), { sent: true });
    assert.deepEqual(await s.send('legacy-2', true), { sent: true });
    assert.deepEqual(await s.send('legacy-3', true), { sent: false, skipped: 'not-confirmed' });
    assert.deepEqual(s.sent.map((m) => m.bookingId), ['legacy-1', 'legacy-2']);
  });

  test('an old-site booking with no email address is skipped, and the button says why', async () => {
    const s = setup({ 'legacy-1': { ...oldSite('reserved'), customerEmail: '' } });
    assert.deepEqual(await findWaiverReminderCandidates(TRIP, s.db), []);
    assert.deepEqual(await s.send('legacy-1', true), { sent: false, skipped: 'no-address' });
    assert.equal(s.sent.length, 0);
    assert.equal(s.store.get('legacy-1')!.waiverReminderClaimedAt, undefined, 'no claim left behind');
  });
});

describe('sendWaiverReminder', () => {
  test('once per departure; the button sends again, and a move gets one for the new date', async () => {
    const s = setup({ b1: { ...base } });
    assert.deepEqual(await s.send('b1'), { sent: true });
    const b = s.store.get('b1')!;
    assert.equal(b.waiverReminderSentFor, `${TRIP}/morning`);
    assert.equal(b.waiverReminderMessageId, 'em_1');
    assert.ok(b.waiverReminderSentAt);
    assert.equal(b.waiverReminderClaimedAt, undefined);

    assert.deepEqual(await s.send('b1'), { sent: false, skipped: 'already-sent' });
    assert.deepEqual(await s.send('b1', true), { sent: true });
    assert.equal(s.sent.length, 2);

    s.store.set('b1', { ...s.store.get('b1')!, date: '2026-11-10' });
    assert.deepEqual(await findWaiverReminderCandidates('2026-11-10', s.db), ['b1']);
    assert.deepEqual(await s.send('b1'), { sent: true });
    assert.equal(s.store.get('b1')!.waiverReminderSentFor, '2026-11-10/morning');
    assert.equal(s.sent.length, 3);
  });

  test('says when the boat leaves, and calls the sunset cruise a cruise', async () => {
    const s = setup({
      morning: { ...base },
      sunset: { ...base, tourName: 'Sunset Cruise — Private', timeSlot: 'sunset', type: 'private' },
    });
    await s.send('morning');
    await s.send('sunset');
    const [morning, sunset] = s.sent;
    assert.match(morning!.text, /before your manatee tour tomorrow:\n.*Morning, departs 8:00 AM \(please arrive by 7:45 AM\)\./);
    assert.match(sunset!.text, /before your sunset cruise tomorrow:\n.*Sunset cruise, departs \d{1,2}:\d{2} PM \(please arrive by/);
    assert.doesNotMatch(sunset!.text, /manatee tour|on the tour/);
  });

  test('a reminder sent before the departure was recorded isn’t sent again for it', async () => {
    const s = setup({ b1: { ...base, waiverReminderSentAt: sentAt } });
    assert.deepEqual(await s.send('b1'), { sent: false, skipped: 'already-sent' });
    assert.equal(s.sent.length, 0);
  });
});

describe('no party size on file', () => {
  test('reminded however many have signed, and asked to make sure everyone has', async () => {
    const s = setup(
      { 'legacy-1': { ...oldSite('reserved'), guestCount: 0 } },
      {
        w1: { bookingId: 'legacy-1', signer: { name: 'Pat Example', participating: true, rosterName: null }, minors: [] },
      },
    );
    assert.deepEqual(await findWaiverReminderCandidates(TRIP, s.db), ['legacy-1']);
    assert.deepEqual(await s.send('legacy-1'), { sent: true });
    const [m] = s.sent;
    assert.equal(m!.subject, 'Tomorrow: make sure everyone in your party has signed the waiver');
    assert.match(
      m!.text,
      /1 person in your party has signed the liability waiver so far\. Make sure everyone else coming on the tour has signed too\./,
    );
    // Not "0 people still need to sign", or an empty list.
    assert.doesNotMatch(m!.subject + m!.text, /(person|people) still|Still to sign/);
  });

  test('with no one signed yet', async () => {
    const s = setup({ 'legacy-1': { ...oldSite('reserved'), guestCount: 0 } });
    assert.deepEqual(await s.send('legacy-1', true), { sent: true });
    assert.match(s.sent[0]!.text, /No one in your party has signed the liability waiver yet\. Make sure everyone coming on the tour signs/);
  });
});

describe('closed departures', () => {
  test('the scheduled run skips departures a blackout covers, the undo window included; the button still sends', async () => {
    const s = setup(
      {
        morning: { ...base },
        charter: { ...base, timeSlot: 'whole-day', type: 'private' },
        late: { ...base, timeSlot: 'late-afternoon' },
      },
      {},
      // Up from the moment he confirms, through the undo window.
      [
        { date: TRIP, affectedSlots: ['morning'], reason: 'weather' },
        { date: '2026-11-10', affectedSlots: ['all'], reason: 'weather' },
      ],
    );
    assert.deepEqual(await findWaiverReminderCandidates(TRIP, s.db), ['late']);

    // Closed after the run picked it: not sent, and left unmarked so it
    // goes if he reopens the departure.
    assert.deepEqual(await s.send('morning'), { sent: false, skipped: 'closed' });
    const b = s.store.get('morning')!;
    assert.equal(b.waiverReminderSentFor, undefined);
    assert.equal(b.waiverReminderClaimedAt, undefined);

    // He left them booked and chose to send one.
    assert.deepEqual(await s.send('morning', true), { sent: true });
    assert.deepEqual(s.sent.map((m) => m.bookingId), ['morning']);
  });
});

describe('“Fix email and resend”', () => {
  test('a bounced waiver reminder goes again to the corrected address, once per bounce', async () => {
    const bounce = {
      emailId: 'em_bounced',
      to: 'pat@exmaple.com',
      subject: 'x',
      bounceType: 'Permanent',
      bounceMessage: 'No such user',
      at: sentAt,
    };
    const s = setup({
      b1: {
        ...base,
        customerEmail: 'pat@exmaple.com',
        waiverReminderSentAt: sentAt,
        waiverReminderSentFor: `${TRIP}/morning`,
        emailBounces: { waiverReminder: bounce },
      },
    });
    const unused = async () => {
      throw new Error('not this one');
    };
    const paths: ResendPaths = {
      confirmation: unused,
      updatedConfirmation: unused,
      closureOffer: unused,
      reminder: unused,
      followup: unused,
      // As adminFixEmail wires it.
      waiverReminder: (b, x) =>
        sendWaiverReminder(b.id, { db: s.db, now: NOW, mail: s.mail, force: true, idempotencyKey: `fix-bounce/${x.emailId}` }),
    };
    const r = await fixBouncedEmail('b1', 'pat@example.com', { db: s.db, now: NOW, paths });
    assert.ok(r.kind === 'done');
    assert.deepEqual(r.results.map((x) => [x.kind, x.outcome]), [['waiverReminder', 'resent']]);
    assert.deepEqual(
      s.sent.map((m) => [m.to, m.idempotencyKey]),
      [['pat@example.com', 'fix-bounce/em_bounced']],
    );
    assert.equal(s.store.get('b1')!.emailBounces, undefined);
  });
});

describe('bounces of waiver emails', () => {
  const at = '2026-11-08T19:59:00.000Z';
  function bounced(kind: string, to: string) {
    const fake = fakeDb(
      { b1: { ...base, id: 'b1' } },
      {
        others: {
          emailLog: {
            em_1: { kind, bookingId: 'b1', waiverId: kind === 'waiverCopy' ? 'w1' : null, crewId: null, to: [to], subject: 'x', status: 'sent', events: [] },
          },
        },
      },
    );
    const alerts: BounceAlert[] = [];
    const run = processResendEvent(
      { type: 'email.bounced', created_at: at, data: { email_id: 'em_1', to: [to], bounce: { type: 'Permanent', message: 'No such user' } } },
      { db: fake.db, now: () => NOW, sendAlert: async (a) => void alerts.push(a) },
    );
    return { ...fake, alerts, run };
  }

  test('a bounced waiver reminder is flagged on the booking and alerts Travis, like the day-before reminder', async () => {
    const h = bounced('waiverReminder', 'pat@example.com');
    const outcome = await h.run;
    assert.equal(outcome.bounceRecorded, true);
    assert.ok((h.store.get('b1')!.emailBounces as Record<string, unknown>).waiverReminder);
    assert.equal(h.alerts.length, 1);
    assert.equal(h.alerts[0]!.kind, 'waiverReminder');
  });

  test('a signer’s copy that bounces is logged, not flagged on the booking or alerted', async () => {
    const h = bounced('waiverCopy', 'guest@example.com');
    await h.run;
    assert.equal(h.coll('emailLog').get('em_1')!.status, 'bounced');
    assert.equal(h.store.get('b1')!.emailBounces, undefined);
    assert.equal(h.alerts.length, 0);
  });
});

/**
 * Closing a day when nobody is watching: the summary email to whoever
 * closed it, picking up a finalize that died partway, and giving up on a
 * booking that was paid for mid-cancel. Run with `npm test` in functions/.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Timestamp } from 'firebase-admin/firestore';

import {
  ClosureError,
  closurePendingFor,
  closurePendingMessage,
  closureReport,
  confirmClosure,
  finalizeClosure,
  finalizeDueClosures,
  previewClosure,
  runClosureCascade,
  undoClosure,
  type FinalizeDeps,
} from '../src/lib/close-day';
import { adminCancelOne, type CancellationMailer } from '../src/lib/admin-cancel';
import { resendClosureOffers, sendClosureReminders } from '../src/closureReminders';
import { resendDeadlineEmails } from '../src/settleClosedBookings';
import { EmailSendError } from '../src/lib/email-log';
import type { AdminContext } from '../src/lib/admin-auth';
import type { ClosureAction } from '../src/lib/types';
import { TOKEN, fakeFirestore, fakeRefunds, fakeStripe, type Doc } from './fakes';

// 9:00 AM at the marina (EDT) on Thursday, October 15, 2026.
const NOW = new Date('2026-10-15T13:00:00Z');
const minutes = (n: number) => new Date(NOW.getTime() + n * 60_000);
const DAY = '2026-10-17'; // Saturday

const travis: AdminContext = { uid: 'travis', email: 'travis@example.com' };

function booking(id: string, over: Doc = {}): Doc {
  return {
    id,
    tourId: 'morning-shared',
    tourName: '2hr Morning Tour — Shared',
    date: DAY,
    timeSlot: 'morning',
    type: 'shared',
    guestCount: 2,
    guests: [],
    customerName: `Guest ${id}`,
    customerEmail: `${id}@example.com`,
    customerPhone: '555-0100',
    accessToken: TOKEN,
    status: 'confirmed',
    paymentStatus: 'paid',
    amountPaidCents: 16800,
    amountRefundedCents: 0,
    stripePaymentIntentId: 'pi_1',
    updatedAt: Timestamp.fromMillis(1_000),
    ...over,
  };
}

function world(bookings: Record<string, Doc>, opts: { checkout?: 'open' | 'complete' } = {}) {
  const fs = fakeFirestore({
    bookings,
    crew: { lacy: { name: 'Lacy', email: 'lacy@example.com' } },
  });
  const sent: Array<{ to: string; subject: string }> = [];
  const mailer: CancellationMailer = {
    marina: { name: 'Marina', address: '1 Dock St' },
    phoneDisplay: '352-586-7792',
    async send({ to, subject }) {
      sent.push({ to, subject });
    },
  };
  const crewEmails: Array<{ to: string; subject: string }> = [];
  const adminEmails: Array<{ to: string; subject: string; text: string; key: string }> = [];
  const { stripe: checkout } = fakeStripe(opts.checkout ?? 'open');
  const refunds = fakeRefunds();
  const deps = (now: Date): FinalizeDeps => ({
    db: fs.db,
    now,
    baseUrl: 'https://example.com',
    stripe: { ...checkout, ...refunds.stripe } as never,
    mailer: () => mailer,
    crew: {
      async push() {},
      async email(msg) {
        crewEmails.push({ to: msg.to, subject: msg.subject });
      },
    },
    async notifyAdmin(msg) {
      adminEmails.push({ to: msg.to, subject: msg.subject, text: msg.text, key: msg.idempotencyKey });
    },
    audit: async () => {},
  });
  const action = (id: string) => fs.col('closureActions').get(id) as unknown as ClosureAction;
  return { ...fs, sent, crewEmails, adminEmails, refunds, deps, action };
}

async function closeDay(w: ReturnType<typeof world>, choice: 'cancel' | 'offer' | 'keep') {
  const p = await previewClosure({ date: DAY, affectedSlots: ['all'], reason: 'weather' }, travis, w.deps(NOW));
  return confirmClosure({ confirmToken: p.choices[choice]!.confirmToken, choice, confirmText: 'CANCEL' }, travis, w.deps(NOW));
}

describe('when the undo window runs out on its own', () => {
  test('whoever closed the day is emailed what went out and what’s left, once', async () => {
    const w = world({
      a: booking('a'),
      'legacy-1': booking('legacy-1', { legacy: { bookingId: 1 }, stripePaymentIntentId: undefined, amountPaidCents: 10000 }),
    });
    const c = await closeDay(w, 'cancel');
    assert.equal(c.state, 'pending');

    await finalizeDueClosures(w.deps(minutes(11)));
    assert.equal(w.action(c.blackoutId).state, 'done');
    assert.equal(w.adminEmails.length, 1);
    const mail = w.adminEmails[0]!;
    assert.equal(mail.to, 'travis@example.com');
    assert.equal(mail.key, `closure-summary/${c.blackoutId}`);
    assert.match(mail.subject, /^\[CRMF\] Closed Sat Oct 17: 1 thing for you to do$/);
    assert.match(mail.text, /Cancelled 2 bookings and emailed each customer/);
    assert.match(mail.text, /Refund \$100 to Guest legacy-1 yourself/);

    // Another scheduler run, or a retry, doesn't send it again.
    await finalizeDueClosures(w.deps(minutes(12)));
    await finalizeClosure(c.blackoutId, 'scheduler', w.deps(minutes(13)));
    assert.equal(w.adminEmails.length, 1);
  });

  test('left booked, it says those customers are still his to contact', async () => {
    const w = world({ a: booking('a'), b: booking('b', { timeSlot: 'mid-morning' }) });
    const c = await closeDay(w, 'keep');
    await finalizeDueClosures(w.deps(minutes(11)));
    assert.equal(w.adminEmails.length, 1);
    const mail = w.adminEmails[0]!;
    assert.match(mail.subject, /^\[CRMF\] Closed Sat Oct 17: 1 thing for you to do$/);
    assert.match(mail.text, /2 bookings are still on for those trips\. Contact those customers yourself\./);
    assert.doesNotMatch(mail.text, /Nothing left for you to do/);
    assert.equal(w.col('bookings').get('a')!.status, 'confirmed');
    assert.equal(w.action(c.blackoutId).state, 'done');
  });

  test('offered a new date, old-website bookings are his to refund if they don’t choose', async () => {
    const w = world({
      a: booking('a'),
      'legacy-1': booking('legacy-1', { legacy: { bookingId: 1 }, stripePaymentIntentId: undefined, amountPaidCents: 10000 }),
    });
    await closeDay(w, 'offer');
    await finalizeDueClosures(w.deps(minutes(11)));
    const mail = w.adminEmails[0]!;
    assert.match(mail.subject, /^\[CRMF\] Closed Sat Oct 17: 1 thing for you to do$/);
    assert.match(mail.text, /Emailed 2 of 2 customers .* Anyone who hasn’t chosen by Tue Oct 20 is refunded automatically\./);
    assert.match(mail.text, /1 booking from the old website \(Guest legacy-1\): if they take the refund or don’t choose by Tue Oct 20, refund them yourself\./);

    // All of them old-site: nothing goes back automatically.
    const { summary } = closureReport('offer', {
      cancelled: [],
      offered: [{ id: 'legacy-1', customerName: 'Ann', timeSlot: 'morning', guests: 0, decideBy: '2026-10-20', emailed: true }],
      failed: [],
    });
    assert.match(summary[0]!, /is cancelled automatically\.$/);
  });

  test('Send now shows the result on screen, so no email', async () => {
    const w = world({ a: booking('a') });
    const c = await closeDay(w, 'cancel');
    await finalizeClosure(c.blackoutId, 'send-now', w.deps(minutes(1)), travis);
    assert.equal(w.action(c.blackoutId).state, 'done');
    assert.equal(w.adminEmails.length, 0);
  });

  test('each booking’s outcome is saved as it happens', async () => {
    const w = world({
      a: booking('a'),
      'legacy-1': booking('legacy-1', { legacy: { bookingId: 1 }, stripePaymentIntentId: undefined, amountPaidCents: 10000 }),
    });
    const c = await closeDay(w, 'cancel');
    await finalizeDueClosures(w.deps(minutes(11)));
    const a = w.action(c.blackoutId);
    assert.deepEqual(Object.keys(a.progress ?? {}).sort(), ['a', 'legacy-1']);
    assert.equal(a.progress!.a!.bucket, 'cancelled');
    assert.deepEqual([...(a.targetIds ?? [])].sort(), ['a', 'legacy-1']);
  });
});

describe('what fails with nobody watching', () => {
  const down: CancellationMailer = {
    marina: { name: 'Marina', address: '1 Dock St' },
    phoneDisplay: '352-586-7792',
    async send() {
      throw new Error('Resend is down');
    },
  };
  function up() {
    const sent: Array<{ to: string; subject: string; text: string; kind?: string; key?: string }> = [];
    const mailer: CancellationMailer = {
      ...down,
      async send({ to, subject, text, kind, idempotencyKey }) {
        sent.push({ to, subject, text, kind, key: idempotencyKey });
      },
    };
    return { mailer, sent };
  }

  test('the crew’s message not reaching them all is on Travis’s list, not “all done”', async () => {
    // Every phone turned the push down (sendCrewPush still resolves).
    const w = world({ a: booking('a') });
    const c = await closeDay(w, 'cancel');
    await finalizeDueClosures({ ...w.deps(minutes(11)), crew: { push: async () => ({ sent: 0, failed: 2, removed: 0 }), email: async () => {} } });
    assert.equal(w.action(c.blackoutId).result!.crewTold, false);
    assert.equal(w.action(c.blackoutId).crewAlert!.pushed, false);
    assert.match(w.adminEmails[0]!.subject, /^\[CRMF\] Closed Sat Oct 17: 1 thing for you to do$/);
    assert.match(w.adminEmails[0]!.text, /The message telling the crew these trips are off didn’t reach them all: tell them yourself\./);

    // A crew email that fails, on a day left booked.
    const k = world({ a: booking('a') });
    const kc = await closeDay(k, 'keep');
    await finalizeDueClosures({ ...k.deps(minutes(11)), crew: { push: async () => {}, email: async () => Promise.reject(new Error('bounced')) } });
    assert.equal(k.action(kc.blackoutId).result!.crewTold, false);
    assert.match(k.adminEmails[0]!.text, /The message telling the crew these trips are closed didn’t reach them all/);

    // No phones signed up for pushes: the emails told them.
    const n = world({ a: booking('a') });
    const nc = await closeDay(n, 'cancel');
    await finalizeDueClosures({ ...n.deps(minutes(11)), crew: { push: async () => ({ sent: 0, failed: 0, removed: 0 }), email: async () => {} } });
    assert.equal(n.action(nc.blackoutId).result!.crewTold, true);
    assert.match(n.adminEmails[0]!.subject, /all done$/);
  });

  test('a summary Resend refuses is sent again under the same key, for up to a day', async () => {
    const w = world({ a: booking('a') });
    const c = await closeDay(w, 'cancel');
    const tries: string[] = [];
    let resendDown = true;
    const deps = (at: Date): FinalizeDeps => ({
      ...w.deps(at),
      async notifyAdmin(msg) {
        tries.push(msg.idempotencyKey);
        if (resendDown) throw new Error('Resend is down');
        w.adminEmails.push({ to: msg.to, subject: msg.subject, text: msg.text, key: msg.idempotencyKey });
      },
    });
    await finalizeDueClosures(deps(minutes(11)));
    assert.equal(w.action(c.blackoutId).adminSummary!.failed, true);
    // Not every minute: a quarter of an hour after the last try.
    await finalizeDueClosures(deps(minutes(20)));
    assert.equal(tries.length, 1);
    await finalizeDueClosures(deps(minutes(27)));
    assert.equal(tries.length, 2);
    resendDown = false;
    await finalizeDueClosures(deps(minutes(35)));
    assert.equal(tries.length, 2);
    await finalizeDueClosures(deps(minutes(43)));
    assert.deepEqual(tries, Array(3).fill(`closure-summary/${c.blackoutId}`));
    assert.equal(w.adminEmails.length, 1);
    assert.match(w.adminEmails[0]!.text, /Cancelled 1 booking and emailed the customer/);
    const marker = w.action(c.blackoutId).adminSummary!;
    assert.equal(marker.failed, undefined);
    assert.ok(marker.sentAt);
    await finalizeDueClosures(deps(minutes(90)));
    assert.equal(tries.length, 3);

    // Still refused a day on: given up, past Resend's idempotency window.
    const g = world({ a: booking('a') });
    const gc = await closeDay(g, 'cancel');
    let given = 0;
    const failing = (at: Date): FinalizeDeps => ({ ...g.deps(at), notifyAdmin: async () => Promise.reject(new Error(`down ${++given}`)) });
    await finalizeDueClosures(failing(minutes(11)));
    await finalizeDueClosures(failing(minutes(11 + 23 * 60 - 1)));
    assert.equal(given, 2);
    await finalizeDueClosures(failing(minutes(11 + 23 * 60 + 30)));
    assert.equal(given, 2);
    assert.equal(g.action(gc.blackoutId).adminSummary!.failed, true);
  });

  test('a cancellation email Resend refuses as the closure goes out is sent again by the hourly run, under the same key', async () => {
    const w = world({ a: booking('a') });
    const c = await closeDay(w, 'cancel');
    const tried: Array<string | undefined> = [];
    const failing: CancellationMailer = {
      ...down,
      async send({ idempotencyKey }) {
        tried.push(idempotencyKey);
        throw new Error('Resend is down');
      },
    };
    await finalizeDueClosures({ ...w.deps(minutes(11)), mailer: () => failing });
    assert.equal(w.col('bookings').get('a')!.status, 'cancelled');
    assert.equal(w.action(c.blackoutId).result!.cancelled[0]!.emailed, false);
    assert.deepEqual(w.col('bookings').get('a')!.deadlineEmail, {
      sent: false,
      refundCents: 16800,
      manualRefundCents: 0,
      previouslyRefundedCents: 0,
      cause: 'trip-closed',
    });

    const { mailer, sent } = up();
    assert.deepEqual(await resendDeadlineEmails({ db: w.db, mailer }), ['a']);
    assert.equal(sent.length, 1);
    // The closure's email, not the deadline's.
    assert.doesNotMatch(sent[0]!.subject, /No new date picked/);
    assert.match(sent[0]!.text, /Closed for weather/);
    assert.deepEqual([tried[0], sent[0]!.key], ['cancellation/a', 'cancellation/a']);
    assert.equal(w.col('bookings').get('a')!.deadlineEmail, undefined);
    assert.deepEqual(await resendDeadlineEmails({ db: w.db, mailer }), []);
  });

  test('a cancellation email Resend refuses for good (the address) isn’t tried every hour: it’s flagged on the booking', async () => {
    // Kept by an earlier run (Resend was down then); the address is one an
    // old-site import never checked.
    const unsent = { sent: false, refundCents: 16800, manualRefundCents: 0, previouslyRefundedCents: 0 };
    const w = world({ a: booking('a', { status: 'cancelled', customerEmail: 'a@example', deadlineEmail: unsent }) });
    let tries = 0;
    const refusing: CancellationMailer = {
      ...down,
      async send() {
        tries++;
        throw new EmailSendError('validation_error', 'Invalid `to` field.');
      },
    };

    assert.deepEqual(await resendDeadlineEmails({ db: w.db, mailer: refusing }), []);
    const a = w.col('bookings').get('a')!;
    assert.equal(a.deadlineEmail, undefined);
    const bounce = (a.emailBounces as Record<string, Record<string, unknown>>).cancellation!;
    assert.deepEqual([bounce.to, bounce.bounceType, bounce.bounceMessage], ['a@example', 'Permanent', 'Resend failed: Invalid `to` field.']);
    assert.match(String(bounce.subject), /No new date picked/);

    // The next hour: nothing to try.
    assert.deepEqual(await resendDeadlineEmails({ db: w.db, mailer: refusing }), []);
    assert.equal(tries, 1);
  });

  test('a booking put back on its trip since (the old-site re-sync) isn’t told it’s cancelled, and the email is dropped', async () => {
    const unsent = { sent: false, refundCents: 0, manualRefundCents: 10000, previouslyRefundedCents: 0, cause: 'admin' };
    const w = world({
      'legacy-1': booking('legacy-1', { status: 'confirmed', deadlineEmail: unsent }),
      b: booking('b', { status: 'cancelled', deadlineEmail: unsent }),
    });
    const { mailer, sent } = up();
    assert.deepEqual(await resendDeadlineEmails({ db: w.db, mailer }), ['b']);
    assert.equal(sent.length, 1);
    assert.equal(w.col('bookings').get('legacy-1')!.deadlineEmail, undefined);
    assert.equal(w.col('bookings').get('legacy-1')!.status, 'confirmed');
    assert.deepEqual(await resendDeadlineEmails({ db: w.db, mailer }), []);
    assert.equal(sent.length, 1);
  });

  test('one Resend refuses for good as the closure goes out is flagged at once, not kept for the hourly run', async () => {
    const w = world({ a: booking('a', { customerEmail: 'a@example' }) });
    await closeDay(w, 'cancel');
    const refusing: CancellationMailer = {
      ...down,
      async send() {
        throw new EmailSendError('validation_error', 'Invalid `to` field.');
      },
    };
    await finalizeDueClosures({ ...w.deps(minutes(11)), mailer: () => refusing });
    const a = w.col('bookings').get('a')!;
    assert.equal(a.status, 'cancelled');
    assert.equal(a.deadlineEmail, undefined);
    assert.equal((a.emailBounces as Record<string, Record<string, unknown>>).cancellation!.bounceType, 'Permanent');
  });

  test('an offer Resend refuses as the closure goes out is sent again by the hourly run, once it has gone out', async () => {
    const w = world({ a: booking('a') });
    const c = await closeDay(w, 'offer');
    await finalizeDueClosures({ ...w.deps(minutes(11)), mailer: () => down });
    const closure = () => w.col('bookings').get('a')!.closure as { offerEmailedAt?: unknown; reminderSentAt?: unknown };
    assert.ok(closure());
    assert.equal(closure().offerEmailedAt, undefined);
    assert.equal(w.action(c.blackoutId).result!.offered[0]!.emailed, false);

    const { mailer, sent } = up();
    const resend = (at: Date) => resendClosureOffers({ db: w.db, now: at, baseUrl: 'https://example.com', mailer });
    // Not while a closure is still going out: its own run sends it.
    w.col('closureActions').set(c.blackoutId, { ...(w.col('closureActions').get(c.blackoutId) as Doc), state: 'finalizing' });
    assert.deepEqual(await resend(minutes(60)), { sent: [], failed: [] });
    w.col('closureActions').set(c.blackoutId, { ...(w.col('closureActions').get(c.blackoutId) as Doc), state: 'done' });

    assert.deepEqual(await resend(minutes(60)), { sent: ['a'], failed: [] });
    assert.equal(sent.length, 1);
    assert.equal(sent[0]!.kind, 'closureOffer');
    assert.equal(sent[0]!.key, `closure-offer/a/${c.blackoutId}`);
    assert.match(sent[0]!.subject, /pick a new date or a refund/);
    assert.ok(closure().offerEmailedAt);
    // Too early for the reminder, so that one still goes the day before.
    assert.equal(closure().reminderSentAt, undefined);
    assert.deepEqual(await resend(minutes(120)), { sent: [], failed: [] });
  });

  test('an offer still unsent when its reminder is due doubles as the reminder; none goes once the time to choose is over', async () => {
    const w = world({ a: booking('a'), b: booking('b', { stripePaymentIntentId: 'pi_2' }) });
    await closeDay(w, 'offer');
    await finalizeDueClosures({ ...w.deps(minutes(11)), mailer: () => down });
    // b's deadline passed long ago: settleClosedBookings has it.
    const b = w.col('bookings').get('b')!;
    w.col('bookings').set('b', { ...b, closure: { ...(b.closure as Doc), decideBy: '2026-10-19' } });
    const { mailer, sent } = up();
    // 6:30 AM on the deadline day (Tue Oct 20), inside the reminder's 24 hours.
    const at = new Date('2026-10-20T10:30:00Z');
    assert.deepEqual(await resendClosureOffers({ db: w.db, now: at, baseUrl: 'https://example.com', mailer }), { sent: ['a'], failed: [] });
    const a = w.col('bookings').get('a')!.closure as { offerEmailedAt?: unknown; reminderSentAt?: unknown };
    assert.ok(a.offerEmailedAt);
    assert.ok(a.reminderSentAt);
    assert.deepEqual(sent.map((s) => s.to), ['a@example.com']);
    // The reminder run that follows in the same hour sends nothing more.
    const reminded = await sendClosureReminders({ db: w.db, now: at, baseUrl: 'https://example.com', send: async () => assert.fail('a second email') });
    assert.deepEqual(reminded, { sent: [], failed: [] });
  });
});

describe('a finalize that died partway', () => {
  /** A cancel closure claimed 20 minutes ago whose run never finished. */
  function crashed(w: ReturnType<typeof world>, blackoutId: string, over: Doc = {}) {
    w.col('closureActions').set(blackoutId, {
      ...(w.col('closureActions').get(blackoutId) as Doc),
      state: 'finalizing',
      claimedAt: Timestamp.fromDate(minutes(-20)),
      claimedBy: 'scheduler',
      claims: 1,
      ...over,
    });
  }

  test('bookings it cancelled before dying are still counted, and Travis is told to check on them', async () => {
    const w = world({ a: booking('a'), b: booking('b', { stripePaymentIntentId: 'pi_2' }) });
    const c = await closeDay(w, 'cancel');
    // The first run cancelled both, then died before saving anything.
    for (const id of ['a', 'b']) {
      w.col('bookings').set(id, {
        ...(w.col('bookings').get(id) as Doc),
        status: 'cancelled',
        cancelledBy: 'admin',
        cancelledByClosure: c.blackoutId,
        closureRefundCents: 16800,
        cancelledAt: Timestamp.fromDate(minutes(1)),
        amountRefundedCents: 16800,
        paymentStatus: 'refunded',
      });
    }
    crashed(w, c.blackoutId);

    await finalizeDueClosures(w.deps(minutes(30)));
    const a = w.action(c.blackoutId);
    assert.equal(a.state, 'done');
    assert.deepEqual(a.result!.cancelled.map((x) => [x.id, x.recovered]).sort(), [['a', true], ['b', true]]);
    // The crew still hear the trip is off.
    assert.equal(w.crewEmails.length, 1);
    assert.match(w.crewEmails[0]!.subject, /4 guests/);
    // And Travis is told to check whether they were emailed.
    assert.equal(w.adminEmails.length, 1);
    assert.match(w.adminEmails[0]!.subject, /2 things for you to do/);
    assert.match(w.adminEmails[0]!.text, /Check on Guest a: their booking was cancelled, but we can’t tell if they were emailed/);
    // No second refund.
    assert.equal(w.refunds.created.length, 0);
  });

  test('a recovered booking reports what the closure refunded, not refunds from before it', async () => {
    const w = world({
      a: booking('a', { paymentStatus: 'partial-refund', amountRefundedCents: 5000 }),
      'legacy-1': booking('legacy-1', { legacy: { bookingId: 1 }, stripePaymentIntentId: undefined, amountPaidCents: 10000 }),
    });
    const c = await closeDay(w, 'cancel');
    // The first run cancelled both, the way it does, then died before saving anything.
    const { stripe: checkout } = fakeStripe('open');
    const { stripe: refunding } = fakeRefunds({ earlier: [{ amount: 5000 }] });
    for (const id of ['a', 'legacy-1']) {
      await adminCancelOne(
        id,
        { reason: 'Closed for weather', notifyCustomer: true, cause: 'blackout', closureId: c.blackoutId },
        { db: w.db, stripe: { ...checkout, ...refunding } as never, mailer: w.deps(NOW).mailer('travis@example.com') },
      );
    }
    assert.equal(w.col('bookings').get('a')!.amountRefundedCents, 16800);
    crashed(w, c.blackoutId);

    await finalizeDueClosures(w.deps(minutes(30)));
    const cancelled = w.action(c.blackoutId).result!.cancelled;
    assert.deepEqual(
      cancelled.map((x) => [x.id, x.refundCents, x.manualRefundCents, x.recovered]).sort(),
      [['a', 11800, 0, true], ['legacy-1', 0, 10000, true]],
    );
    assert.match(w.adminEmails[0]!.text, /Refund \$100 to Guest legacy-1 yourself/);
  });

  test('a saved outcome wins over guessing, and the rest are done now', async () => {
    const w = world({ a: booking('a'), b: booking('b') });
    const c = await closeDay(w, 'cancel');
    w.col('bookings').set('a', {
      ...(w.col('bookings').get('a') as Doc),
      status: 'cancelled',
      cancelledBy: 'admin',
      cancelledAt: Timestamp.fromDate(minutes(1)),
      amountRefundedCents: 16800,
    });
    crashed(w, c.blackoutId, {
      targetIds: ['a', 'b'],
      progress: {
        a: {
          bucket: 'cancelled',
          entry: { id: 'a', customerName: 'Guest a', timeSlot: 'morning', guests: 2, refundCents: 16800, manualRefundCents: 0, emailed: true },
        },
      },
    });

    await finalizeDueClosures(w.deps(minutes(30)));
    const result = w.action(c.blackoutId).result!;
    assert.deepEqual(result.cancelled.map((x) => [x.id, x.emailed, !!x.recovered]).sort(), [['a', true, false], ['b', true, false]]);
    // Only b was cancelled and emailed by this run.
    assert.deepEqual(w.sent.map((s) => s.to), ['b@example.com']);
    assert.match(w.adminEmails[0]!.subject, /all done$/);
  });

  test('a booking moved or cancelled by the customer isn’t claimed as cancelled by the closure', async () => {
    const w = world({ a: booking('a') });
    const c = await closeDay(w, 'cancel');
    w.col('bookings').set('a', {
      ...(w.col('bookings').get('a') as Doc),
      status: 'cancelled',
      cancelledBy: 'customer',
      cancelledAt: Timestamp.fromDate(minutes(1)),
    });
    crashed(w, c.blackoutId);
    await finalizeDueClosures(w.deps(minutes(30)));
    assert.deepEqual(w.action(c.blackoutId).result!.cancelled, []);
  });

  test('nor is one Travis cancelled by hand, or a checkout that ran out, while it was down', async () => {
    const w = world({
      a: booking('a'),
      hold: booking('hold', { status: 'pending-payment', paymentStatus: 'pending', amountPaidCents: 0, stripePaymentIntentId: undefined }),
    });
    const c = await closeDay(w, 'cancel');
    for (const id of ['a', 'hold']) {
      w.col('bookings').set(id, {
        ...(w.col('bookings').get(id) as Doc),
        status: 'cancelled',
        cancelledBy: 'admin',
        cancelledAt: Timestamp.fromDate(minutes(1)),
      });
    }
    crashed(w, c.blackoutId);
    await finalizeDueClosures(w.deps(minutes(30)));
    assert.deepEqual(w.action(c.blackoutId).result!.cancelled, []);
    // Nothing to tell Travis, and nothing for the crew.
    assert.equal(w.adminEmails.length, 1);
    assert.match(w.adminEmails[0]!.subject, /all done$/);
    assert.equal(w.crewEmails.length, 0);
  });

  test('a booking the closure cancels carries its id', async () => {
    const w = world({ a: booking('a') });
    const c = await closeDay(w, 'cancel');
    assert.equal(w.action(c.blackoutId).stampsCancels, true);
    await finalizeClosure(c.blackoutId, 'send-now', w.deps(minutes(1)), travis);
    assert.equal(w.col('bookings').get('a')!.cancelledByClosure, c.blackoutId);
  });

  test('one confirmed before cancels were stamped counts what was cancelled from admin since, as it did then', async () => {
    const w = world({
      a: booking('a'),
      'legacy-1': booking('legacy-1', { legacy: { bookingId: 1 }, stripePaymentIntentId: undefined, amountPaidCents: 10000 }),
      mine: booking('mine', { stripePaymentIntentId: 'pi_2' }),
    });
    const c = await closeDay(w, 'cancel');
    // Confirmed by the version before the stamp, which died partway: its
    // cancels say only who cancelled them and when.
    const { stampsCancels: _s, ...before } = w.col('closureActions').get(c.blackoutId)!;
    void _s;
    w.col('closureActions').set(c.blackoutId, before);
    const cancelled = { status: 'cancelled', cancelledBy: 'admin', cancelledAt: Timestamp.fromDate(minutes(1)) } as const;
    w.col('bookings').set('a', { ...w.col('bookings').get('a'), ...cancelled, amountRefundedCents: 16800, paymentStatus: 'refunded' });
    w.col('bookings').set('legacy-1', { ...w.col('bookings').get('legacy-1'), ...cancelled });
    // The customer cancelled this one themselves.
    w.col('bookings').set('mine', { ...w.col('bookings').get('mine'), ...cancelled, cancelledBy: 'customer' });
    crashed(w, c.blackoutId);

    await finalizeDueClosures(w.deps(minutes(30)));
    const a = w.action(c.blackoutId);
    assert.equal(a.state, 'done');
    assert.deepEqual(
      a.result!.cancelled.map((x) => [x.id, x.refundCents, x.manualRefundCents, x.recovered]).sort(),
      [['a', 16800, 0, true], ['legacy-1', 0, 10000, true]],
    );
    // The crew still hear the trip is off.
    assert.equal(w.crewEmails.length, 1);
    assert.equal(w.refunds.created.length, 0);
  });
});

describe('a booking paid for mid-cancel', () => {
  test('once the retries run out it says to open the booking, not that it’s being tried again', async () => {
    const w = world(
      { a: booking('a', { status: 'pending-payment', paymentStatus: 'unpaid', amountPaidCents: 0, stripePaymentIntentId: undefined, stripeCheckoutSessionId: 'cs_1' }) },
      { checkout: 'complete' },
    );
    const c = await closeDay(w, 'cancel');
    w.col('closureActions').set(c.blackoutId, { ...(w.col('closureActions').get(c.blackoutId) as Doc), retries: 3 });

    const done = await finalizeClosure(c.blackoutId, 'scheduler', w.deps(minutes(11)));
    assert.equal(done.kind, 'finalized');
    const failed = w.action(c.blackoutId).result!.failed;
    assert.equal(failed.length, 1);
    assert.equal(failed[0]!.retryable, false);
    const { problems } = closureReport('cancel', w.action(c.blackoutId).result!);
    assert.deepEqual(problems, ['Guest a’s booking was NOT cancelled. Open it and cancel it there.']);
  });
});

describe('a booking moved just as its refund went out', () => {
  test('says it was refunded and to check it, not to cancel it: that would cancel the trip it moved to', async () => {
    const refunds = fakeRefunds();
    const fs = fakeFirestore(
      { bookings: { a: booking('a') } },
      {
        // Travis moves it to the next Saturday as Stripe takes the refund.
        beforeCommit: (data) => {
          const b = data.get('bookings')!;
          if (refunds.created.length === 1 && b.get('a')!.date === DAY) b.set('a', { ...b.get('a'), date: '2026-10-24' });
        },
      },
    );
    const { stripe: checkout } = fakeStripe('open');
    const mailer: CancellationMailer = { marina: { name: 'Marina', address: '1 Dock St' }, phoneDisplay: '352-586-7792', async send() {} };
    const result = await runClosureCascade(
      { blackoutId: 'bo1', date: DAY, slots: ['all'], reason: 'weather', choice: 'cancel' },
      { db: fs.db, now: NOW, baseUrl: 'https://example.com', stripe: { ...checkout, ...refunds.stripe } as never, mailer },
    );

    assert.equal(fs.col('bookings').get('a')!.status, 'confirmed');
    assert.deepEqual(result.failed.map((f) => [f.id, f.refundedAnyway]), [['a', true]]);
    assert.deepEqual(closureReport('cancel', result).problems, [
      'Guest a: $168 was refunded to them, but the booking changed at the same moment. Open the booking and check it.',
    ]);
  });
});

describe('during the undo window', () => {
  test('a customer’s own cancel is held off until the closure goes through', async () => {
    const w = world({ a: booking('a'), b: booking('b', { timeSlot: 'late-afternoon', tourId: 'late-afternoon-shared' }) });
    const p = await previewClosure({ date: DAY, affectedSlots: ['morning'], reason: 'weather' }, travis, w.deps(NOW));
    const c = await confirmClosure({ confirmToken: p.choices.offer!.confirmToken, choice: 'offer', confirmText: 'cancel' }, travis, w.deps(NOW));
    assert.equal(c.state, 'pending');

    assert.equal((await closurePendingFor(w.db, DAY, 'morning'))?.choice, 'offer');
    assert.equal(await closurePendingFor(w.db, DAY, 'late-afternoon'), null);
    assert.match(closurePendingMessage('offer'), /pick a new date or take a full refund/);

    await finalizeClosure(c.blackoutId, 'send-now', w.deps(minutes(1)), travis);
    assert.equal(await closurePendingFor(w.db, DAY, 'morning'), null);
  });

  test('after an Undo, another choice from the same review can’t be confirmed', async () => {
    const w = world({ a: booking('a') });
    const p = await previewClosure({ date: DAY, affectedSlots: ['all'], reason: 'weather' }, travis, w.deps(NOW));
    const c = await confirmClosure({ confirmToken: p.choices.offer!.confirmToken, choice: 'offer', confirmText: 'CANCEL' }, travis, w.deps(NOW));
    const undone = await undoClosure(c.blackoutId, travis, { db: w.db, now: minutes(1) });
    assert.equal(undone.kind, 'undone');

    await assert.rejects(
      confirmClosure({ confirmToken: p.choices.cancel!.confirmToken, choice: 'cancel', confirmText: 'CANCEL' }, travis, w.deps(minutes(2))),
      (err: unknown) => err instanceof ClosureError && err.code === 'stale',
    );
    assert.equal(w.col('blackouts').size, 0);
  });
});

/**
 * "Fix email and resend": the new address is saved, each bounced email goes
 * out again where there's a way to, the rest say "call them", and the
 * bounce flags clear. Against an in-memory Firestore. Run with `npm test`
 * in functions/.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { fixBouncedEmail, type ResendPaths } from '../src/lib/fix-bounced-email';
import { resendTripPhotosEmail } from '../src/lib/trip-photos';
import type { Booking, EmailBounce } from '../src/lib/types';
import { TOKEN, fakeDb, fakeResend, type Doc } from './fakes';

// 9:00 AM at the marina on Thursday, October 15, 2026.
const NOW = new Date('2026-10-15T13:00:00Z');

const at = { toMillis: () => NOW.getTime() };
const bounced = (kind: string, extra: Partial<EmailBounce> = {}) => ({
  emailId: `em_${kind}`,
  to: 'jane@exmaple.com',
  subject: kind,
  bounceType: 'Permanent',
  bounceMessage: 'Mailbox does not exist',
  at,
  ...extra,
});

function booking(extra: Doc = {}): Doc {
  return {
    id: 'b1',
    tourId: 'mid-morning-shared',
    tourName: '2hr Mid-morning Tour — Shared',
    date: '2026-10-16',
    timeSlot: 'mid-morning',
    type: 'shared',
    guestCount: 2,
    guests: [],
    customerName: 'Jane Smith',
    customerEmail: 'jane@exmaple.com',
    customerPhone: '352-555-0100',
    accessToken: TOKEN,
    status: 'confirmed',
    paymentStatus: 'paid',
    amountPaidCents: 16800,
    amountRefundedCents: 0,
    ...extra,
  };
}

/** Records what each path was asked to send, and to whom. */
function paths(
  opts: {
    fail?: string;
    followup?: { sent: boolean; skipped?: string };
    waiverReminder?: { sent: boolean; skipped?: string };
    photos?: { sent: boolean; skipped?: string };
  } = {},
) {
  const sent: Array<{ kind: string; to: string; emailId: string }> = [];
  const make = (kind: string) => async (b: Booking, bounce: EmailBounce) => {
    if (opts.fail === kind) throw new Error('Resend failed: down');
    sent.push({ kind, to: b.customerEmail, emailId: bounce.emailId });
  };
  const p: ResendPaths = {
    confirmation: make('confirmation'),
    updatedConfirmation: make('reschedule'),
    closureOffer: make('closureOffer'),
    reminder: make('reminder'),
    async waiverReminder(b, bounce) {
      await make('waiverReminder')(b, bounce);
      return opts.waiverReminder ?? { sent: true };
    },
    async followup(b, bounce) {
      await make('followup')(b, bounce);
      return opts.followup ?? { sent: true };
    },
    async photos(b, bounce) {
      await make('photos')(b, bounce);
      return opts.photos ?? { sent: true };
    },
  };
  return { paths: p, sent };
}

describe('fixBouncedEmail', () => {
  test('saves the address, resends the confirmation and tomorrow’s reminder, and clears the flags', async () => {
    const { db, store } = fakeDb({
      b1: booking({
        emailBounces: { reminder: bounced('reminder'), confirmation: bounced('confirmation') },
        bounceAlertSentAt: { confirmation: at, reminder: at, other: at },
      }),
    });
    const { paths: p, sent } = paths();
    const r = await fixBouncedEmail('b1', ' jane@example.com ', { db, now: NOW, paths: p });

    assert.equal(r.kind, 'done');
    assert.ok(r.kind === 'done');
    assert.equal(r.before, 'jane@exmaple.com');
    assert.equal(r.after, 'jane@example.com');
    // Confirmation first.
    assert.deepEqual(sent, [
      { kind: 'confirmation', to: 'jane@example.com', emailId: 'em_confirmation' },
      { kind: 'reminder', to: 'jane@example.com', emailId: 'em_reminder' },
    ]);
    assert.deepEqual(r.results.map((x) => [x.kind, x.outcome]), [['confirmation', 'resent'], ['reminder', 'resent']]);

    const b = store.get('b1')!;
    assert.equal(b.customerEmail, 'jane@example.com');
    assert.equal(b.emailBounces, undefined);
    // Cleared for the kinds it fixed, so a new bounce alerts again.
    assert.deepEqual(Object.keys(b.bounceAlertSentAt as object), ['other']);
  });

  test('a bounced kind with no way to resend says call them, and is cleared', async () => {
    const { db, store } = fakeDb({ b1: booking({ emailBounces: { cancellation: bounced('cancellation') } }) });
    const { paths: p, sent } = paths();
    const r = await fixBouncedEmail('b1', 'jane@example.com', { db, now: NOW, paths: p });
    assert.ok(r.kind === 'done');
    assert.equal(sent.length, 0);
    assert.equal(r.results[0]!.outcome, 'skipped');
    assert.equal(r.results[0]!.callThem, true);
    assert.equal(store.get('b1')!.emailBounces, undefined);
  });

  test('the “your trip is closed” note isn’t sent again: it said Travis would be in touch', async () => {
    const { db, store } = fakeDb({ b1: booking({ emailBounces: { closedTrip: bounced('closedTrip') } }) });
    const { paths: p, sent } = paths();
    const r = await fixBouncedEmail('b1', 'jane@example.com', { db, now: NOW, paths: p });
    assert.ok(r.kind === 'done');
    assert.equal(sent.length, 0);
    assert.deepEqual(r.results.map((x) => [x.label, x.outcome, x.callThem]), [['“your trip is closed” email', 'skipped', true]]);
    assert.match(r.results[0]!.reason!, /would be in touch to move them or refund them in full/);
    assert.equal(store.get('b1')!.emailBounces, undefined);
  });

  test('one that fails to send stays flagged; the others still go', async () => {
    const { db, store } = fakeDb({
      b1: booking({ emailBounces: { confirmation: bounced('confirmation'), reminder: bounced('reminder') } }),
    });
    const { paths: p, sent } = paths({ fail: 'confirmation' });
    const r = await fixBouncedEmail('b1', 'jane@example.com', { db, now: NOW, paths: p });
    assert.ok(r.kind === 'done');
    assert.deepEqual(r.results.map((x) => [x.kind, x.outcome]), [['confirmation', 'failed'], ['reminder', 'resent']]);
    assert.equal(r.results[0]!.reason, 'Resend failed: down');
    assert.deepEqual(sent.map((s) => s.kind), ['reminder']);
    assert.deepEqual(Object.keys(store.get('b1')!.emailBounces as object), ['confirmation']);
  });

  test('a reminder for a trip further out isn’t sent now: it goes the day before', async () => {
    const { db } = fakeDb({ b1: booking({ date: '2026-10-20', emailBounces: { reminder: bounced('reminder') } }) });
    const { paths: p, sent } = paths();
    const r = await fixBouncedEmail('b1', 'jane@example.com', { db, now: NOW, paths: p });
    assert.ok(r.kind === 'done');
    assert.equal(sent.length, 0);
    assert.equal(r.results[0]!.outcome, 'skipped');
    assert.equal(r.results[0]!.callThem, undefined);
  });

  test('an updated confirmation is covered by the confirmation when both bounced', async () => {
    const { db } = fakeDb({
      b1: booking({ emailBounces: { reschedule: bounced('reschedule'), confirmation: bounced('confirmation') } }),
    });
    const { paths: p, sent } = paths();
    const r = await fixBouncedEmail('b1', 'jane@example.com', { db, now: NOW, paths: p });
    assert.ok(r.kind === 'done');
    assert.deepEqual(sent.map((s) => s.kind), ['confirmation']);
    assert.deepEqual(r.results.map((x) => [x.kind, x.outcome]), [['confirmation', 'resent'], ['reschedule', 'resent']]);
  });

  test('no “your tour is confirmed” for a departure Travis closed: the offer goes instead', async () => {
    const closure = { blackoutId: 'bo1', reason: 'Closed for weather', decideBy: '2026-10-19', offeredAt: at };
    const { db, store } = fakeDb({
      b1: booking({ closure, emailBounces: { confirmation: bounced('confirmation'), closureOffer: bounced('closureOffer') } }),
    });
    const { paths: p, sent } = paths();
    const r = await fixBouncedEmail('b1', 'jane@example.com', { db, now: NOW, paths: p });
    assert.ok(r.kind === 'done');
    assert.deepEqual(sent.map((s) => s.kind), ['closureOffer']);
    assert.deepEqual(r.results.map((x) => [x.kind, x.outcome]), [['confirmation', 'skipped'], ['closureOffer', 'resent']]);
    assert.equal(store.get('b1')!.emailBounces, undefined);
  });

  test('nor for one he closed and left booked, or closed from MCP: no closure on the booking, a blackout on the day', async () => {
    const { db, store } = fakeDb(
      {
        b1: booking({
          emailBounces: { confirmation: bounced('confirmation'), reschedule: bounced('reschedule'), reminder: bounced('reminder') },
        }),
      },
      { blackouts: [{ date: '2026-10-16', affectedSlots: ['mid-morning'] }] },
    );
    const { paths: p, sent } = paths();
    const r = await fixBouncedEmail('b1', 'jane@example.com', { db, now: NOW, paths: p });
    assert.ok(r.kind === 'done');
    assert.equal(sent.length, 0);
    assert.deepEqual(r.results.map((x) => [x.kind, x.outcome, x.callThem]), [
      ['confirmation', 'skipped', true],
      ['reschedule', 'skipped', true],
      ['reminder', 'skipped', true],
    ]);
    assert.match(r.results[0]!.reason!, /You closed that departure/);
    assert.equal(store.get('b1')!.customerEmail, 'jane@example.com', 'the address is still saved');

    // Another departure closed that day doesn't stop it.
    const other = fakeDb(
      { b1: booking({ emailBounces: { confirmation: bounced('confirmation') } }) },
      { blackouts: [{ date: '2026-10-16', affectedSlots: ['morning'] }] },
    );
    const q = paths();
    await fixBouncedEmail('b1', 'jane@example.com', { db: other.db, now: NOW, paths: q.paths });
    assert.deepEqual(q.sent.map((x) => x.kind), ['confirmation']);
  });

  test('saves the address lowercased, as checkout does', async () => {
    const { db, store } = fakeDb({ b1: booking({ emailBounces: { confirmation: bounced('confirmation') } }) });
    const { paths: p, sent } = paths();
    const r = await fixBouncedEmail('b1', ' Jane.Smith@Example.com ', { db, now: NOW, paths: p });
    assert.ok(r.kind === 'done');
    assert.equal(r.after, 'jane.smith@example.com');
    assert.equal(store.get('b1')!.customerEmail, 'jane.smith@example.com');
    assert.equal(sent[0]!.to, 'jane.smith@example.com');
  });

  test('no confirmation, original or updated, for a trip that’s already happened', async () => {
    const { db } = fakeDb({
      b1: booking({ date: '2026-10-14', emailBounces: { confirmation: bounced('confirmation'), reschedule: bounced('reschedule') } }),
    });
    const { paths: p, sent } = paths();
    const r = await fixBouncedEmail('b1', 'jane@example.com', { db, now: NOW, paths: p });
    assert.ok(r.kind === 'done');
    assert.equal(sent.length, 0);
    assert.deepEqual(r.results.map((x) => [x.kind, x.outcome]), [['confirmation', 'skipped'], ['reschedule', 'skipped']]);
  });

  test('the closure offer goes again only while they’re still choosing', async () => {
    const closure = { blackoutId: 'bo1', reason: 'Closed for weather', decideBy: '2026-10-19', offeredAt: at };
    const open = fakeDb({ b1: booking({ closure, emailBounces: { closureOffer: bounced('closureOffer') } }) });
    const a = paths();
    const r1 = await fixBouncedEmail('b1', 'jane@example.com', { db: open.db, now: NOW, paths: a.paths });
    assert.ok(r1.kind === 'done');
    assert.equal(r1.results[0]!.outcome, 'resent');

    const settled = fakeDb({ b1: booking({ emailBounces: { closureOffer: bounced('closureOffer') } }) });
    const b = paths();
    const r2 = await fixBouncedEmail('b1', 'jane@example.com', { db: settled.db, now: NOW, paths: b.paths });
    assert.ok(r2.kind === 'done');
    assert.equal(r2.results[0]!.outcome, 'skipped');
    assert.equal(b.sent.length, 0);
  });

  test('a bounced closure reminder resends the offer, once, even if the offer bounced too', async () => {
    const closure = { blackoutId: 'bo1', reason: 'Closed for weather', decideBy: '2026-10-19', offeredAt: at };
    const both = fakeDb({
      b1: booking({ closure, emailBounces: { closureReminder: bounced('closureReminder'), closureOffer: bounced('closureOffer') } }),
    });
    const a = paths();
    const r1 = await fixBouncedEmail('b1', 'jane@example.com', { db: both.db, now: NOW, paths: a.paths });
    assert.ok(r1.kind === 'done');
    assert.deepEqual(a.sent.map((s) => s.kind), ['closureOffer']);
    assert.deepEqual(r1.results.map((x) => [x.kind, x.outcome]), [['closureOffer', 'resent'], ['closureReminder', 'resent']]);

    const reminderOnly = fakeDb({ b1: booking({ closure, emailBounces: { closureReminder: bounced('closureReminder') } }) });
    const b = paths();
    const r2 = await fixBouncedEmail('b1', 'jane@example.com', { db: reminderOnly.db, now: NOW, paths: b.paths });
    assert.ok(r2.kind === 'done');
    assert.deepEqual(b.sent.map((s) => s.kind), ['closureOffer']);
    assert.equal(r2.results[0]!.outcome, 'resent');
  });

  test('the follow-up’s own skip reason comes back', async () => {
    const { db } = fakeDb({ b1: booking({ status: 'completed', emailBounces: { followup: bounced('followup') } }) });
    const { paths: p } = paths({ followup: { sent: false, skipped: 'too-old' } });
    const r = await fixBouncedEmail('b1', 'jane@example.com', { db, now: NOW, paths: p });
    assert.ok(r.kind === 'done');
    assert.equal(r.results[0]!.outcome, 'skipped');
    assert.match(r.results[0]!.reason!, /too long ago/);
  });

  test('a bounced trip photos email goes again to the new address, with the gallery link', async () => {
    // Read when the email is built and sent.
    process.env.APP_BASE_URL = 'https://example.com';
    process.env.RESEND_FROM_EMAIL = 'Manatee Fun <hello@example.com>';
    const { db, store } = fakeDb(
      { b1: booking({ date: '2026-10-12', status: 'completed', photosSentAt: at, emailBounces: { photos: bounced('photos') } }) },
      { others: { tripPhotos: { '2026-10-12_mid-morning': { uploadToken: 'u'.repeat(32), photoCount: 12 } } } },
    );
    const { resend, sent } = fakeResend();
    const real = paths().paths;
    // As adminFixEmail wires it.
    real.photos = async (b, bounce) =>
      resendTripPhotosEmail(b, { adminEmail: 'travis@example.com', idempotencyKey: `fix-bounce/${bounce.emailId}`, deps: { db, resend } });

    const r = await fixBouncedEmail('b1', 'jane@example.com', { db, now: NOW, paths: real });

    assert.ok(r.kind === 'done');
    assert.deepEqual(r.results.map((x) => [x.kind, x.outcome, x.label]), [['photos', 'resent', 'trip photos email']]);
    assert.equal(sent.length, 1);
    const { payload, options } = sent[0]!;
    assert.deepEqual(payload.to, ['jane@example.com']);
    assert.equal(payload.bcc, 'travis@example.com');
    assert.deepEqual(payload.tags?.[0], { name: 'kind', value: 'photos' });
    assert.ok(payload.text!.includes(`https://example.com/my-booking/b1/photos?t=${TOKEN}`));
    assert.match(payload.text!, /12 photos and videos/);
    assert.deepEqual(options, { idempotencyKey: 'fix-bounce/em_photos' });
    assert.equal(store.get('b1')!.emailBounces, undefined);
  });

  test('the photos email isn’t sent again for a booking that didn’t go out, or an empty gallery', async () => {
    process.env.APP_BASE_URL = 'https://example.com';
    const cases: Array<[string, Doc, Doc, RegExp]> = [
      ['no-show', { status: 'no-show' }, { uploadToken: 'u'.repeat(32), photoCount: 12 }, /didn’t go out on the boat/],
      ['all deleted', { status: 'completed' }, { uploadToken: 'u'.repeat(32), photoCount: 0 }, /nothing in their photo gallery/],
      // The old Drive-only uploader left a count, but nothing in the gallery.
      ['old uploader', { status: 'completed' }, { photoCount: 12 }, /nothing in their photo gallery/],
    ];
    for (const [name, extra, trip, reason] of cases) {
      const { db } = fakeDb(
        { b1: booking({ date: '2026-10-12', emailBounces: { photos: bounced('photos') }, ...extra }) },
        { others: { tripPhotos: { '2026-10-12_mid-morning': trip } } },
      );
      const { resend, sent } = fakeResend();
      const p = paths().paths;
      p.photos = (b, bounce) =>
        resendTripPhotosEmail(b, { adminEmail: 'travis@example.com', idempotencyKey: `fix-bounce/${bounce.emailId}`, deps: { db, resend } });
      const r = await fixBouncedEmail('b1', 'jane@example.com', { db, now: NOW, paths: p });
      assert.ok(r.kind === 'done', name);
      assert.equal(r.results[0]!.outcome, 'skipped', name);
      assert.match(r.results[0]!.reason!, reason, name);
      assert.equal(sent.length, 0, name);
    }
  });

  test('a bounced waiver reminder goes again to the new address, after tomorrow’s reminder', async () => {
    const { db, store } = fakeDb({
      b1: booking({
        emailBounces: {
          waiverReminder: bounced('waiverReminder'),
          reminder: bounced('reminder'),
          confirmation: bounced('confirmation'),
        },
      }),
    });
    const { paths: p, sent } = paths();
    const r = await fixBouncedEmail('b1', 'jane@example.com', { db, now: NOW, paths: p });
    assert.ok(r.kind === 'done');
    assert.deepEqual(sent, [
      { kind: 'confirmation', to: 'jane@example.com', emailId: 'em_confirmation' },
      { kind: 'reminder', to: 'jane@example.com', emailId: 'em_reminder' },
      { kind: 'waiverReminder', to: 'jane@example.com', emailId: 'em_waiverReminder' },
    ]);
    assert.deepEqual(r.results.map((x) => [x.kind, x.outcome]), [
      ['confirmation', 'resent'],
      ['reminder', 'resent'],
      ['waiverReminder', 'resent'],
    ]);
    assert.equal(r.results[2]!.label, 'waiver reminder');
    assert.equal(store.get('b1')!.emailBounces, undefined);
  });

  test('the waiver reminder’s own skip reason comes back', async () => {
    const reasons: Record<string, RegExp> = {
      'all-signed': /signed since/,
      past: /already happened/,
      closed: /closed that departure/,
      'not-confirmed': /isn’t going ahead/,
    };
    for (const [skipped, reason] of Object.entries(reasons)) {
      const { db, store } = fakeDb({ b1: booking({ emailBounces: { waiverReminder: bounced('waiverReminder') } }) });
      const { paths: p } = paths({ waiverReminder: { sent: false, skipped } });
      const r = await fixBouncedEmail('b1', 'jane@example.com', { db, now: NOW, paths: p });
      assert.ok(r.kind === 'done');
      assert.equal(r.results[0]!.outcome, 'skipped', skipped);
      assert.match(r.results[0]!.reason!, reason);
      assert.equal(store.get('b1')!.emailBounces, undefined);
    }
  });

  test('a waiver reminder already on its way (maybe to the old address) stays flagged, to try again', async () => {
    const { db, store } = fakeDb({ b1: booking({ emailBounces: { waiverReminder: bounced('waiverReminder') } }) });
    const { paths: p } = paths({ waiverReminder: { sent: false, skipped: 'in-progress' } });
    const r = await fixBouncedEmail('b1', 'jane@example.com', { db, now: NOW, paths: p });
    assert.ok(r.kind === 'done');
    assert.equal(r.results[0]!.outcome, 'failed');
    assert.match(r.results[0]!.reason!, /same moment/);
    assert.deepEqual(Object.keys(store.get('b1')!.emailBounces as object), ['waiverReminder']);
    assert.equal(store.get('b1')!.customerEmail, 'jane@example.com');
  });

  test('refuses the address that bounced permanently, and changes nothing', async () => {
    const { db, store } = fakeDb({ b1: booking({ emailBounces: { confirmation: bounced('confirmation') } }) });
    const { paths: p, sent } = paths();
    const r = await fixBouncedEmail('b1', 'JANE@exmaple.com', { db, now: NOW, paths: p });
    assert.equal(r.kind, 'same-address');
    assert.equal(sent.length, 0);
    assert.ok(store.get('b1')!.emailBounces);
  });

  test('the same address after a temporary bounce is allowed: it may work now', async () => {
    const { db } = fakeDb({ b1: booking({ emailBounces: { confirmation: bounced('confirmation', { bounceType: 'Transient' }) } }) });
    const { paths: p, sent } = paths();
    const r = await fixBouncedEmail('b1', 'jane@exmaple.com', { db, now: NOW, paths: p });
    assert.equal(r.kind, 'done');
    assert.equal(sent.length, 1);
  });

  test('nothing bounced, or no booking', async () => {
    const { db } = fakeDb({ b1: booking() });
    const { paths: p } = paths();
    assert.equal((await fixBouncedEmail('b1', 'jane@example.com', { db, now: NOW, paths: p })).kind, 'nothing-bounced');
    assert.equal((await fixBouncedEmail('nope', 'jane@example.com', { db, now: NOW, paths: p })).kind, 'not-found');
  });

  test('a bounce that lands during the fix (a new email id) isn’t cleared', async () => {
    const fake = fakeDb({ b1: booking({ emailBounces: { confirmation: bounced('confirmation') } }) });
    const { paths: p } = paths();
    const confirmation = p.confirmation;
    p.confirmation = async (b, bounce) => {
      await confirmation(b, bounce);
      fake.store.set('b1', {
        ...fake.store.get('b1')!,
        emailBounces: { confirmation: bounced('confirmation', { emailId: 'em_new', to: 'jane@example.com' }) },
      });
    };
    await fixBouncedEmail('b1', 'jane@example.com', { db: fake.db, now: NOW, paths: p });
    const left = fake.store.get('b1')!.emailBounces as Record<string, { emailId: string }>;
    assert.equal(left.confirmation!.emailId, 'em_new');
  });
});

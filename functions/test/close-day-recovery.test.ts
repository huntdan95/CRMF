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
  undoClosure,
  type FinalizeDeps,
} from '../src/lib/close-day';
import { adminCancelOne, type CancellationMailer } from '../src/lib/admin-cancel';
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
    await finalizeClosure(c.blackoutId, 'send-now', w.deps(minutes(1)), travis);
    assert.equal(w.col('bookings').get('a')!.cancelledByClosure, c.blackoutId);
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

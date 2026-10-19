/**
 * Closing a day with the safeguards: preview and confirm token, the undo
 * window, finalizing once, and the crew alert. Against in-memory stand-ins
 * for Firestore, Stripe, email and push. Run with `npm test` in functions/.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Timestamp } from 'firebase-admin/firestore';

import {
  ClosureError,
  alertCrewOnce,
  alertCrewRestoredOnce,
  confirmClosure,
  finalizeClosure,
  finalizeDueClosures,
  previewClosure,
  restoreOfferedBookings,
  undoClosure,
  type FinalizeDeps,
} from '../src/lib/close-day';
import { recordCompletedCheckout } from '../src/lib/checkout-completed';
import { settleExpiredClosures } from '../src/settleClosedBookings';
import { sendTourReminders } from '../src/tourReminders';
import type { CancellationMailer } from '../src/lib/admin-cancel';
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

function world(bookings: Record<string, Doc>, extra: Record<string, Record<string, Doc>> = {}) {
  const fs = fakeFirestore({
    bookings,
    crew: {
      lacy: { name: 'Lacy', email: 'lacy@example.com' },
      faith: { name: 'Faith', email: 'faith@example.com' },
    },
    ...extra,
  });
  const sent: Array<{ to: string; subject: string; text: string; key?: string }> = [];
  const mailer: CancellationMailer = {
    marina: { name: 'Marina', address: '1 Dock St' },
    phoneDisplay: '352-586-7792',
    async send({ to, subject, text, idempotencyKey }) {
      sent.push({ to, subject, text, key: idempotencyKey });
    },
  };
  const pushes: Array<{ title: string; body: string }> = [];
  const crewEmails: Array<{ to: string; subject: string }> = [];
  const audits: Array<{ action: string; targetId: string }> = [];
  const { stripe: checkout } = fakeStripe('open');
  const refunds = fakeRefunds();
  const deps = (now: Date): FinalizeDeps => ({
    db: fs.db,
    now,
    baseUrl: 'https://example.com',
    stripe: { ...checkout, ...refunds.stripe } as never,
    mailer: () => mailer,
    crew: {
      async push(msg) {
        pushes.push(msg);
      },
      async email(msg) {
        crewEmails.push({ to: msg.to, subject: msg.subject });
      },
    },
    audit: async (e) => {
      audits.push({ action: e.action, targetId: e.targetId });
    },
  });
  const action = (id: string) => fs.col('closureActions').get(id) as unknown as ClosureAction;
  return { ...fs, sent, pushes, crewEmails, audits, refunds, deps, action };
}

async function preview(w: ReturnType<typeof world>, slots: string[] = ['all'], at = NOW) {
  return previewClosure({ date: DAY, affectedSlots: slots as never, reason: 'weather' }, travis, w.deps(at));
}

describe('previewClosure', () => {
  test('lists each departure, every booking and what would happen, with the real emails, and sends nothing', async () => {
    const w = world({
      a: booking('a', { guestCount: 4 }),
      b: booking('b', { timeSlot: 'mid-morning', tourId: 'mid-morning-shared', stripePaymentIntentId: 'pi_2' }),
      'legacy-1': booking('legacy-1', { timeSlot: 'mid-morning', legacy: { bookingId: 1 }, stripePaymentIntentId: undefined, amountPaidCents: 10000 }),
      gone: booking('gone', { status: 'cancelled' }),
      other: booking('other', { date: '2026-10-18' }),
    });
    const p = await preview(w);

    assert.deepEqual(p.bookings.map((b) => b.id), ['a', 'b', 'legacy-1']);
    assert.equal(p.guests, 8);
    assert.deepEqual(
      p.departures.map((d) => [d.departs, d.bookings, d.guests]),
      [['8:00 AM', 1, 4], ['10:30 AM', 2, 4], ['1:00 PM', 0, 0], ['3:30 PM', 0, 0]],
    );
    const legacy = p.bookings.find((b) => b.id === 'legacy-1')!;
    assert.deepEqual(legacy.outcomes.cancel, { kind: 'cancel', refundCents: 0, manualRefundCents: 10000, unpaidCheckout: false });
    assert.deepEqual(p.bookings[0]!.outcomes.offer, { kind: 'offer', decideBy: '2026-10-20' });
    assert.equal(p.choices.offer!.emails.length, 3);
    assert.match(p.choices.offer!.emails[0]!.subject, /Saturday, Oct 17 tour can’t go out/);
    assert.match(p.choices.cancel!.emails[2]!.html, /refund your \$100 himself/);
    assert.equal(p.farAhead, false);
    assert.equal(p.undoMinutes, 10);
    // Nothing happened.
    assert.equal(w.sent.length, 0);
    assert.equal(w.col('blackouts').size, 0);
    assert.equal(w.col('bookings').get('a')!.closure, undefined);
    assert.deepEqual(w.audits.map((a) => a.action), ['closure.preview']);
  });

  test('won’t close a past date or a departure that has left, and warns about dates more than 3 days out', async () => {
    const w = world({});
    await assert.rejects(
      previewClosure({ date: '2026-10-14', affectedSlots: ['all'] }, travis, w.deps(NOW)),
      /date has passed/,
    );
    // 9:00 AM: the 8:00 is out.
    await assert.rejects(
      previewClosure({ date: '2026-10-15', affectedSlots: ['morning'] }, travis, w.deps(NOW)),
      /8:00 AM trip has already left/,
    );
    await assert.rejects(
      previewClosure({ date: '2026-10-15', affectedSlots: ['all'] }, travis, w.deps(NOW)),
      /Pick the trips still to go/,
    );
    const later = await previewClosure({ date: '2026-10-15', affectedSlots: ['mid-morning', 'early-afternoon'] }, travis, w.deps(NOW));
    assert.equal(later.farAhead, false);
    const far = await previewClosure({ date: '2026-10-19', affectedSlots: ['all'] }, travis, w.deps(NOW));
    assert.equal(far.farAhead, true);
  });
});

describe('confirmClosure', () => {
  test('refuses a token that wasn’t issued, one for another choice, and no CANCEL', async () => {
    const w = world({ a: booking('a') });
    const p = await preview(w);
    const deps = w.deps(NOW);
    await assert.rejects(confirmClosure({ confirmToken: 'x'.repeat(43), choice: 'offer', confirmText: 'CANCEL' }, travis, deps), /doesn’t match what you reviewed/);
    await assert.rejects(
      confirmClosure({ confirmToken: p.choices.cancel!.confirmToken, choice: 'offer', confirmText: 'CANCEL' }, travis, deps),
      /doesn’t match what you reviewed/,
    );
    await assert.rejects(
      confirmClosure({ confirmToken: p.choices.offer!.confirmToken, choice: 'offer', confirmText: 'cancle' }, travis, deps),
      /Type CANCEL/,
    );
    await assert.rejects(
      confirmClosure({ confirmToken: p.choices.offer!.confirmToken, choice: 'offer', confirmText: 'CANCEL' }, { uid: 'other', email: 'o@example.com' }, deps),
      /doesn’t match/,
    );
    assert.equal(w.col('blackouts').size, 0);
  });

  test('refuses a stale preview: a booking changed, was added or was cancelled since', async () => {
    for (const change of [
      (b: Map<string, Doc>) => b.set('a', { ...b.get('a'), guestCount: 3, updatedAt: Timestamp.fromMillis(2_000) }),
      (b: Map<string, Doc>) => b.set('new', booking('new', { status: 'pending-payment', stripePaymentIntentId: undefined, amountPaidCents: 0 })),
      (b: Map<string, Doc>) => b.set('a', { ...b.get('a'), status: 'cancelled' }),
      (b: Map<string, Doc>) => b.set('a', { ...b.get('a'), amountRefundedCents: 5000 }),
    ]) {
      const w = world({ a: booking('a') });
      const p = await preview(w);
      change(w.col('bookings'));
      await assert.rejects(
        confirmClosure({ confirmToken: p.choices.offer!.confirmToken, choice: 'offer', confirmText: 'CANCEL' }, travis, w.deps(minutes(1))),
        (err: unknown) => err instanceof ClosureError && err.code === 'stale' && /Something changed since you looked/.test(err.message),
      );
      assert.equal(w.col('blackouts').size, 0);
      assert.equal(w.col('closureActions').size, 0);
    }
  });

  test('refuses a preview more than half an hour old', async () => {
    const w = world({ a: booking('a') });
    const p = await preview(w);
    await assert.rejects(
      confirmClosure({ confirmToken: p.choices.offer!.confirmToken, choice: 'offer', confirmText: 'CANCEL' }, travis, w.deps(minutes(31))),
      (err: unknown) => err instanceof ClosureError && err.code === 'expired',
    );
  });

  test('blocks the departures at once and does nothing else until the undo window is up', async () => {
    const w = world({ a: booking('a') });
    const p = await preview(w);
    const r = await confirmClosure({ confirmToken: p.choices.cancel!.confirmToken, choice: 'cancel', confirmText: 'cancel' }, travis, w.deps(NOW));

    assert.equal(r.state, 'pending');
    assert.equal(r.finalizeAt, minutes(10).toISOString());
    assert.deepEqual(w.col('blackouts').get(r.blackoutId)!.affectedSlots, ['all']);
    const action = w.action(r.blackoutId);
    assert.equal(action.state, 'pending');
    assert.equal(action.createdBy, 'travis@example.com');
    assert.equal(action.choice, 'cancel');
    assert.equal(w.col('bookings').get('a')!.status, 'confirmed');
    assert.equal(w.sent.length, 0);
    assert.equal(w.refunds.created.length, 0);
    assert.equal(w.pushes.length + w.crewEmails.length, 0);

    // A second tap with the same token doesn't close it twice.
    const again = await confirmClosure({ confirmToken: p.choices.cancel!.confirmToken, choice: 'cancel', confirmText: 'cancel' }, travis, w.deps(NOW));
    assert.equal(again.blackoutId, r.blackoutId);
    assert.equal(again.alreadyConfirmed, true);
    assert.equal(w.col('blackouts').size, 1);

    // Nor can another preview for the same day go through meanwhile.
    await assert.rejects(preview(w, ['late-afternoon']), /already closing trips on that day/);
  });

  test('a day nobody is booked on just closes, with no window and no CANCEL needed', async () => {
    const w = world({});
    const p = await preview(w);
    assert.deepEqual(Object.keys(p.choices), ['keep']);
    const r = await confirmClosure({ confirmToken: p.choices.keep!.confirmToken, choice: 'keep' }, travis, w.deps(NOW));
    assert.equal(r.state, 'done');
    assert.equal(w.col('blackouts').size, 1);
    assert.equal(w.pushes.length, 0);
  });
});

describe('undo', () => {
  test('removes the blackout, leaves the bookings alone and sends nothing, even after the window', async () => {
    const before = booking('a');
    const w = world({ a: before, b: booking('b', { timeSlot: 'mid-morning', stripePaymentIntentId: 'pi_1' }) });
    const p = await preview(w);
    const r = await confirmClosure({ confirmToken: p.choices.cancel!.confirmToken, choice: 'cancel', confirmText: 'CANCEL' }, travis, w.deps(NOW));

    const u = await undoClosure(r.blackoutId, travis, { db: w.db, now: minutes(3), audit: w.deps(NOW).audit });
    assert.equal(u.kind, 'undone');
    assert.equal(w.col('blackouts').size, 0);
    assert.equal(w.action(r.blackoutId).state, 'undone');

    // The scheduler runs well after the window: nothing happens.
    const later = await finalizeDueClosures(w.deps(minutes(30)));
    assert.deepEqual(later, { finalized: [], failed: [] });
    assert.equal((await finalizeClosure(r.blackoutId, 'send-now', w.deps(minutes(31)))).kind, 'undone');

    assert.deepEqual(w.col('bookings').get('a'), before);
    assert.equal(w.col('bookings').get('b')!.status, 'confirmed');
    assert.equal(w.sent.length, 0);
    assert.equal(w.refunds.created.length, 0);
    assert.equal(w.pushes.length + w.crewEmails.length, 0);
    assert.deepEqual(w.audits.map((a) => a.action), ['closure.preview', 'closure.confirm', 'closure.undo']);

    // The used token can't bring it back.
    await assert.rejects(
      confirmClosure({ confirmToken: p.choices.cancel!.confirmToken, choice: 'cancel', confirmText: 'CANCEL' }, travis, w.deps(minutes(4))),
      /You undid this one/,
    );
  });

  test('is too late once it has gone out', async () => {
    const w = world({ a: booking('a') });
    const p = await preview(w);
    const r = await confirmClosure({ confirmToken: p.choices.offer!.confirmToken, choice: 'offer', confirmText: 'CANCEL' }, travis, w.deps(NOW));
    await finalizeClosure(r.blackoutId, 'send-now', w.deps(minutes(1)), travis);
    const u = await undoClosure(r.blackoutId, travis, { db: w.db, now: minutes(2) });
    assert.deepEqual(u, { kind: 'too-late', state: 'done' });
    assert.equal(w.col('blackouts').size, 1);
  });
});

describe('finalizeClosure', () => {
  test('Send now and the scheduler racing: it runs once', async () => {
    const w = world({ a: booking('a'), b: booking('b', { timeSlot: 'mid-morning' }) });
    const p = await preview(w);
    const r = await confirmClosure({ confirmToken: p.choices.offer!.confirmToken, choice: 'offer', confirmText: 'CANCEL' }, travis, w.deps(NOW));

    const at = minutes(10);
    const outcomes = await Promise.all([
      finalizeClosure(r.blackoutId, 'send-now', w.deps(at), travis),
      finalizeDueClosures(w.deps(at)),
      finalizeClosure(r.blackoutId, 'scheduler', w.deps(at)),
    ]);
    const kinds = [outcomes[0].kind, outcomes[2].kind];
    const ran = kinds.filter((k) => k === 'finalized').length + outcomes[1].finalized.length;
    assert.equal(ran, 1, JSON.stringify(outcomes));

    assert.equal(w.sent.length, 2);
    assert.deepEqual(w.sent.map((s) => s.to).sort(), ['a@example.com', 'b@example.com']);
    assert.equal(w.pushes.length, 1);
    assert.equal(w.crewEmails.length, 2);
    assert.equal(w.action(r.blackoutId).state, 'done');
    assert.equal(w.audits.filter((a) => a.action === 'closure.finalize').length, 1);

    // And again later: nothing more goes out.
    assert.equal((await finalizeClosure(r.blackoutId, 'send-now', w.deps(minutes(20)))).kind, 'already-done');
    await finalizeDueClosures(w.deps(minutes(21)));
    assert.equal(w.sent.length, 2);
    assert.equal(w.pushes.length, 1);
  });

  test('the scheduler waits for the window; a booking paid during it is included', async () => {
    const w = world({
      a: booking('a'),
      // Someone in Stripe checkout when Travis closed the day.
      hold: booking('hold', {
        status: 'pending-payment',
        paymentStatus: 'pending',
        amountPaidCents: 0,
        stripePaymentIntentId: undefined,
        stripeCheckoutSessionId: 'cs_1',
        customerEmail: 'hold@example.com',
      }),
    });
    const p = await preview(w);
    assert.deepEqual(p.bookings.find((b) => b.id === 'hold')!.outcomes.offer, {
      kind: 'cancel',
      refundCents: 0,
      manualRefundCents: 0,
      unpaidCheckout: true,
    });
    const r = await confirmClosure({ confirmToken: p.choices.offer!.confirmToken, choice: 'offer', confirmText: 'CANCEL' }, travis, w.deps(NOW));

    assert.deepEqual(await finalizeDueClosures(w.deps(minutes(5))), { finalized: [], failed: [] });
    assert.equal(w.sent.length, 0);

    // They finish paying during the window.
    const outcome = await recordCompletedCheckout(
      {
        id: 'cs_1',
        metadata: { bookingId: 'hold' },
        payment_status: 'paid',
        amount_total: 16800,
        payment_intent: 'pi_1',
        livemode: false,
      } as never,
      { stripe: w.refunds.stripe, db: w.db, sendConfirmation: async () => {}, alertAdmin: async () => {} },
    );
    assert.equal(outcome, 'confirmed');

    const done = await finalizeDueClosures(w.deps(minutes(10)));
    assert.deepEqual(done.finalized, [r.blackoutId]);
    const hold = w.col('bookings').get('hold')!;
    assert.equal(hold.status, 'confirmed');
    assert.equal((hold.closure as { blackoutId: string }).blackoutId, r.blackoutId);
    assert.deepEqual(w.sent.map((s) => s.to).sort(), ['a@example.com', 'hold@example.com']);
    assert.ok(w.sent.every((s) => /pick a new date or a refund/.test(s.subject)));
    assert.match(w.crewEmails[0]!.subject, /^\[CRMF\] Weather cancel: Sat Oct 17, 8:00 \(4 guests\)$/);
  });

  test('cancel refunds this site’s payments and notes old-site money, then tells the crew', async () => {
    const w = world({
      a: booking('a', { guestCount: 4 }),
      'legacy-2': booking('legacy-2', { timeSlot: 'mid-morning', legacy: { bookingId: 2 }, stripePaymentIntentId: undefined, amountPaidCents: 10000, guestCount: 3 }),
    });
    const p = await preview(w);
    const r = await confirmClosure({ confirmToken: p.choices.cancel!.confirmToken, choice: 'cancel', confirmText: 'CANCEL' }, travis, w.deps(NOW));
    const f = await finalizeClosure(r.blackoutId, 'send-now', w.deps(minutes(2)), travis);

    assert.equal(f.kind, 'finalized');
    assert.deepEqual(w.refunds.created, [{ amount: 16800, key: 'blackout-cancel-a' }]);
    assert.equal(w.col('bookings').get('a')!.status, 'cancelled');
    assert.equal(w.col('bookings').get('legacy-2')!.status, 'cancelled');
    assert.match(String(w.col('bookings').get('legacy-2')!.adminNotes), /Refund it by hand/);
    assert.deepEqual(w.crewEmails.map((e) => e.to).sort(), ['faith@example.com', 'lacy@example.com']);
    assert.equal(w.crewEmails[0]!.subject, '[CRMF] Weather cancel: Sat Oct 17, 8:00 and 10:30 (7 guests)');
    assert.deepEqual(w.pushes, [
      { title: 'Weather cancel: Sat Oct 17', body: '8:00 and 10:30 are off · 7 guests', url: '/crew', tag: `closure-${r.blackoutId}` },
    ]);
  });

  test('a crashed finalize is picked up again without emailing anyone twice', async () => {
    const w = world({ a: booking('a') });
    const p = await preview(w);
    const r = await confirmClosure({ confirmToken: p.choices.offer!.confirmToken, choice: 'offer', confirmText: 'CANCEL' }, travis, w.deps(NOW));
    // First run sends the offer. Then put the action back the way a run
    // that died before marking it done would leave it: claimed, no crew alert.
    await finalizeClosure(r.blackoutId, 'scheduler', w.deps(minutes(10)));
    const claimed = { ...w.col('closureActions').get(r.blackoutId)!, state: 'finalizing' };
    delete claimed.crewAlert;
    w.col('closureActions').set(r.blackoutId, claimed as Doc);
    assert.equal(w.sent.length, 1);

    // Too soon: still leased to the first run.
    assert.deepEqual(await finalizeDueClosures(w.deps(minutes(12))), { finalized: [], failed: [] });
    const later = await finalizeDueClosures(w.deps(minutes(40)));
    assert.deepEqual(later.finalized, [r.blackoutId]);
    assert.equal(w.sent.length, 1, 'the offer email went out once');
    assert.equal(w.action(r.blackoutId).state, 'done');
  });

  test('reopening the day while it waits is the same as undo', async () => {
    const w = world({ a: booking('a') });
    const p = await preview(w);
    const r = await confirmClosure({ confirmToken: p.choices.offer!.confirmToken, choice: 'offer', confirmText: 'CANCEL' }, travis, w.deps(NOW));
    const u = await undoClosure(r.blackoutId, travis, { db: w.db, now: minutes(1) }, 'reopen');
    assert.equal(u.kind, 'undone');
    // Or if the blackout disappears some other way.
    const w2 = world({ a: booking('a') });
    const p2 = await preview(w2);
    const r2 = await confirmClosure({ confirmToken: p2.choices.offer!.confirmToken, choice: 'offer', confirmText: 'CANCEL' }, travis, w2.deps(NOW));
    w2.col('blackouts').delete(r2.blackoutId);
    assert.equal((await finalizeClosure(r2.blackoutId, 'scheduler', w2.deps(minutes(11)))).kind, 'undone');
    assert.equal(w2.sent.length, 0);
  });

  test('a booking paid for as it was being cancelled is tried again before the crew are told', async () => {
    const w = world({
      hold: booking('hold', {
        status: 'pending-payment',
        paymentStatus: 'pending',
        amountPaidCents: 0,
        stripePaymentIntentId: undefined,
        stripeCheckoutSessionId: 'cs_1',
      }),
    });
    const p = await preview(w);
    const r = await confirmClosure({ confirmToken: p.choices.cancel!.confirmToken, choice: 'cancel', confirmText: 'CANCEL' }, travis, w.deps(NOW));
    // Stripe says the session completed, but our webhook hasn't landed yet.
    const { stripe: completed } = fakeStripe('complete');
    const deps = w.deps(minutes(10));
    const first = await finalizeClosure(r.blackoutId, 'scheduler', { ...deps, stripe: { ...completed, ...w.refunds.stripe } as never });
    assert.equal(first.kind === 'finalized' && first.retrying, true);
    assert.equal(w.action(r.blackoutId).state, 'finalizing');
    assert.equal(w.pushes.length, 0);

    // The webhook confirms it; the retry cancels and refunds it.
    w.col('bookings').set('hold', { ...w.col('bookings').get('hold'), status: 'confirmed', paymentStatus: 'paid', amountPaidCents: 16800, stripePaymentIntentId: 'pi_1' });
    const retry = await finalizeDueClosures(w.deps(minutes(12)));
    assert.deepEqual(retry.finalized, [r.blackoutId]);
    assert.equal(w.col('bookings').get('hold')!.status, 'cancelled');
    assert.deepEqual(w.refunds.created, [{ amount: 16800, key: 'blackout-cancel-hold' }]);
    assert.equal(w.action(r.blackoutId).state, 'done');
    assert.equal(w.pushes.length, 1);
  });
});

describe('reopening a day after it went out', () => {
  /** Closes `slots` on DAY with "pick a new date" and sends it. */
  async function offer(w: ReturnType<typeof world>, slots: string[]) {
    const p = await preview(w, slots);
    const r = await confirmClosure({ confirmToken: p.choices.offer!.confirmToken, choice: 'offer', confirmText: 'CANCEL' }, travis, w.deps(NOW));
    await finalizeClosure(r.blackoutId, 'send-now', w.deps(minutes(1)), travis);
    return r.blackoutId;
  }

  test('puts anyone still choosing back on their trip; moved and refunded bookings stay as they are', async () => {
    const w = world({
      a: booking('a', { adminNotes: 'Birthday' }),
      moved: booking('moved', { stripePaymentIntentId: 'pi_2' }),
      refunded: booking('refunded', { timeSlot: 'mid-morning', stripePaymentIntentId: 'pi_3' }),
    });
    const id = await offer(w, ['all']);
    // One moves to another day, one takes the refund.
    const moved = { ...w.col('bookings').get('moved')!, date: '2026-10-24' };
    delete moved.closure;
    w.col('bookings').set('moved', moved);
    w.col('bookings').set('refunded', { ...w.col('bookings').get('refunded'), status: 'cancelled' });
    const untouched = { moved: w.col('bookings').get('moved'), refunded: w.col('bookings').get('refunded') };

    const restored = await restoreOfferedBookings(id, { db: w.db, now: minutes(30) });
    assert.deepEqual(restored, [{ id: 'a', customerName: 'Guest a', date: DAY, timeSlot: 'morning', guests: 2 }]);
    const a = w.col('bookings').get('a')!;
    assert.equal(a.closure, undefined);
    assert.equal(a.status, 'confirmed');
    assert.equal(a.adminNotes, 'Birthday\n2026-10-15: Back on this trip: you reopened the day after they were asked to pick a new date (closed for weather).');
    assert.deepEqual(w.col('bookings').get('moved'), untouched.moved);
    assert.deepEqual(w.col('bookings').get('refunded'), untouched.refunded);
    assert.deepEqual(w.action(id).restoredBookingIds, ['a']);

    // Again (a retried reopen): nothing more changes, and they're still listed.
    w.col('blackouts').delete(id);
    assert.deepEqual(await restoreOfferedBookings(id, { db: w.db, now: minutes(31) }), restored);
    assert.equal(w.col('bookings').get('a')!.adminNotes, a.adminNotes);

    // They get the day-before reminder, and aren't refunded at the deadline.
    const reminders: string[] = [];
    await sendTourReminders({
      db: w.db,
      now: new Date('2026-10-16T13:00:00Z'),
      baseUrl: 'https://example.com',
      forecast: async () => null,
      async send(msg) {
        reminders.push(msg.bookingId);
        return { id: null };
      },
    });
    assert.deepEqual(reminders, ['a']);
    const d = w.deps(new Date('2026-10-22T13:00:00Z'));
    const settled = await settleExpiredClosures({ db: w.db, stripe: d.stripe, mailer: d.mailer('travis@example.com'), now: d.now });
    assert.deepEqual(settled, { settled: [], failed: [] });
    assert.equal(w.col('bookings').get('a')!.status, 'confirmed');
  });

  test('not onto a trip that has already left, nor one another closed day still covers', async () => {
    const w = world({
      early: booking('early'),
      late: booking('late', { timeSlot: 'early-afternoon', tourId: 'early-afternoon-shared' }),
      charter: booking('charter', { timeSlot: 'whole-day', type: 'private', tourId: 'whole-day-private' }),
    });
    const day = await offer(w, ['all']);
    // Something else closed the 1:00 too (from MCP, say).
    w.col('blackouts').set('mcp', { date: DAY, affectedSlots: ['early-afternoon'] });

    // 11:00 AM on the day: the 8:00 has left, and the charter at 7:00.
    const restored = await restoreOfferedBookings(day, { db: w.db, now: new Date('2026-10-17T15:00:00Z') });
    assert.deepEqual(restored, []);
    for (const id of ['early', 'late', 'charter']) {
      assert.equal((w.col('bookings').get(id)!.closure as { blackoutId: string }).blackoutId, day, id);
    }
  });

  test('two closures of the same trip, reopened in either order', async () => {
    for (const order of ['morning first', 'day first'] as const) {
      const w = world({ a: booking('a') });
      const morning = await offer(w, ['morning']);
      // Later the whole day goes: the morning booking is offered again, under the new closure.
      const day = await offer(w, ['all']);
      assert.equal((w.col('bookings').get('a')!.closure as { blackoutId: string }).blackoutId, day);

      const [first, second] = order === 'morning first' ? [morning, day] : [day, morning];
      // The other one still covers the morning: nothing yet.
      assert.deepEqual(await restoreOfferedBookings(first, { db: w.db, now: minutes(30) }), [], order);
      w.col('blackouts').delete(first);
      assert.deepEqual((await restoreOfferedBookings(second, { db: w.db, now: minutes(31) })).map((r) => r.id), ['a'], order);
      assert.equal(w.col('bookings').get('a')!.closure, undefined, order);
    }
  });

  test('a customer taking the refund at the same moment wins', async () => {
    const closure = { blackoutId: 'bo1', reason: 'Closed for weather', decideBy: '2026-10-20', offeredAt: Timestamp.fromMillis(1_000) };
    const fs = fakeFirestore(
      { bookings: { a: booking('a', { closure }) }, blackouts: { bo1: { date: DAY, affectedSlots: ['all'] } } },
      {
        beforeCommit: (data, attempt) => {
          const b = data.get('bookings')!;
          if (attempt === 1) b.set('a', { ...b.get('a'), status: 'cancelled' });
        },
      },
    );
    assert.deepEqual(await restoreOfferedBookings('bo1', { db: fs.db, now: NOW }), []);
    assert.equal(fs.col('bookings').get('a')!.status, 'cancelled');
    assert.deepEqual(fs.col('bookings').get('a')!.closure, closure);
  });

  test('a reopen that fails partway and is tried again still lists everyone put back', async () => {
    const closure = { blackoutId: 'bo1', reason: 'Closed for weather', decideBy: '2026-10-20', offeredAt: Timestamp.fromMillis(1_000) };
    let commits = 0;
    const fs = fakeFirestore(
      {
        bookings: { a: booking('a', { closure }), b: booking('b', { closure, timeSlot: 'mid-morning' }) },
        blackouts: { bo1: { date: DAY, affectedSlots: ['all'] } },
        closureActions: { bo1: { state: 'done', date: DAY } },
      },
      {
        // The second booking's write fails.
        beforeCommit: () => {
          if (++commits === 2) throw new Error('Firestore unavailable');
        },
      },
    );
    await assert.rejects(restoreOfferedBookings('bo1', { db: fs.db, now: NOW }), /Firestore unavailable/);
    assert.equal(fs.col('bookings').get('a')!.closure, undefined);
    assert.deepEqual(fs.col('closureActions').get('bo1')!.restoredBookingIds, ['a']);

    // The query only finds b now; a comes from the closure's record.
    const retry = await restoreOfferedBookings('bo1', { db: fs.db, now: NOW });
    assert.deepEqual(retry.map((r) => r.id).sort(), ['a', 'b']);
    assert.deepEqual(fs.col('closureActions').get('bo1')!.restoredBookingIds, ['a', 'b']);
  });

  test('the crew, told the trip was off, hear it’s back on, once', async () => {
    const w = world({ a: booking('a', { guestCount: 4 }) });
    const id = await offer(w, ['all']);
    assert.equal(w.pushes.length, 1);
    const restored = await restoreOfferedBookings(id, { db: w.db, now: minutes(30) });
    const deps = { db: w.db, crew: w.deps(NOW).crew, now: minutes(30), baseUrl: 'https://example.com' };

    assert.deepEqual(await alertCrewRestoredOnce(id, restored, deps), { told: true });
    assert.deepEqual(w.pushes[1], { title: 'Back on: Sat Oct 17', body: '8:00 is going out after all · 4 guests', url: '/crew', tag: `closure-${id}` });
    assert.deepEqual(
      w.crewEmails.slice(2),
      ['lacy@example.com', 'faith@example.com'].map((to) => ({ to, subject: '[CRMF] Back on: Sat Oct 17, 8:00 (4 guests)' })),
    );

    // A retried reopen: nothing more goes out.
    assert.deepEqual(await alertCrewRestoredOnce(id, restored, deps), { told: true });
    assert.equal(w.pushes.length, 2);
    assert.equal(w.crewEmails.length, 4);
  });

  test('back on: a party size not on file, a failed email, and nothing if the crew never heard it was off', async () => {
    const told = { claimedAt: Timestamp.fromMillis(1_000), sentAt: Timestamp.fromMillis(1_000) };
    const w = world({}, { closureActions: { bo1: { state: 'done', date: DAY, crewAlert: told }, bo2: { state: 'done', date: DAY } } });
    const restored = [
      { id: 'a', customerName: 'A', date: DAY, timeSlot: 'morning' as const, guests: 3 },
      { id: 'legacy-1', customerName: 'B', date: DAY, timeSlot: 'mid-morning' as const, guests: 0 },
    ];
    const subjects: string[] = [];
    const crew = {
      push: async () => {},
      email: async ({ to, subject }: { to: string; subject: string }) => {
        if (to === 'lacy@example.com') throw new Error('bounced');
        subjects.push(subject);
      },
    };
    const deps = { db: w.db, crew, now: NOW, baseUrl: 'https://example.com' };
    assert.deepEqual(await alertCrewRestoredOnce('bo1', restored, deps), { told: false });
    assert.deepEqual(subjects, ['[CRMF] Back on: Sat Oct 17, 8:00 and 10:30 (3+ guests)']);
    assert.deepEqual(w.action('bo1').reopenCrewAlert!.failedCrewIds, ['lacy']);
    // Asked again: how the first went, and nothing re-sent.
    assert.deepEqual(await alertCrewRestoredOnce('bo1', restored, deps), { told: false });
    assert.equal(subjects.length, 1);

    assert.equal(await alertCrewRestoredOnce('bo2', restored, deps), null);
    assert.equal(w.action('bo2').reopenCrewAlert, undefined);
  });
});

describe('alertCrewOnce', () => {
  test('sends once per closure, and a failed email doesn’t stop the others', async () => {
    const w = world({}, { closureActions: { bo1: { state: 'finalizing' } } });
    const result = {
      cancelled: [],
      offered: [{ id: 'a', customerName: 'A', timeSlot: 'morning' as const, guests: 6, decideBy: '2026-10-20', emailed: true }],
      failed: [],
    };
    const emails: string[] = [];
    const crew = {
      push: async () => {},
      email: async ({ to }: { to: string }) => {
        if (to === 'lacy@example.com') throw new Error('bounced');
        emails.push(to);
      },
    };
    const action = { date: DAY, reason: 'weather' as const, choice: 'offer' as const };
    assert.deepEqual(await alertCrewOnce('bo1', action, result, { db: w.db, crew, now: NOW, baseUrl: 'https://example.com' }), { sent: true });
    assert.deepEqual(await alertCrewOnce('bo1', action, result, { db: w.db, crew, now: NOW, baseUrl: 'https://example.com' }), { sent: false });
    assert.deepEqual(emails, ['faith@example.com']);
    const marker = w.action('bo1').crewAlert!;
    assert.deepEqual(marker.failedCrewIds, ['lacy']);
    assert.deepEqual(marker.emailedCrewIds, ['faith']);
    assert.equal(marker.subject, '[CRMF] Weather cancel: Sat Oct 17, 8:00 (6 guests)');
  });
});

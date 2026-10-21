/**
 * Closing a day with the safeguards: preview and confirm token, the undo
 * window, finalizing once, the crew alert, reopening, and closures an old
 * reopen left behind. Against in-memory stand-ins
 * for Firestore, Stripe, email and push. Run with `npm test` in functions/.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Timestamp } from 'firebase-admin/firestore';

import {
  ClosureError,
  alertCrewClosedFromMcp,
  alertCrewOnce,
  alertCrewRestoredOnce,
  assertReopenable,
  closureReport,
  confirmClosure,
  confirmPaidWhileClosed,
  finalizeClosure,
  finalizeDueClosures,
  findLeftStillBooked,
  findStillClosed,
  isStaleClosure,
  previewClosure,
  restoreOfferedBookings,
  undoClosure,
  type FinalizeDeps,
} from '../src/lib/close-day';
import { adminMarkOne } from '../src/lib/admin-mark';
import { recordCompletedCheckout, type PaidOnClosedDeparture } from '../src/lib/checkout-completed';
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
  const audits: Array<{ action: string; targetId: string; payload?: Record<string, unknown> }> = [];
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
      audits.push({ action: e.action, targetId: e.targetId, payload: e.payload });
    },
  });
  const action = (id: string) => fs.col('closureActions').get(id) as unknown as ClosureAction;
  return { ...fs, sent, pushes, crewEmails, audits, refunds, deps, action };
}

/**
 * Stripe's webhook for a checkout started before the day was closed,
 * finishing now: what the customer and Travis were sent.
 */
async function payCheckout(w: ReturnType<typeof world>, bookingId: string) {
  const confirmations: string[] = [];
  const closedAlerts: PaidOnClosedDeparture['closure'][] = [];
  const outcome = await recordCompletedCheckout(
    { id: 'cs_1', metadata: { bookingId }, payment_status: 'paid', amount_total: 16800, payment_intent: 'pi_1', livemode: false } as never,
    {
      stripe: w.refunds.stripe,
      db: w.db,
      sendConfirmation: async (id) => {
        confirmations.push(id);
      },
      alertAdmin: async () => {},
      alertClosedDeparture: async (alert) => {
        closedAlerts.push(alert.closure);
      },
    },
  );
  return { outcome, confirmations, closedAlerts };
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
    // Nothing else closes the day: it's open for booking again.
    assert.equal(u.kind === 'undone' && u.stillClosed, null);
    assert.equal(w.action(r.blackoutId).stillClosed, undefined);

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

  test('says when another closed day still covers its trips, so they aren’t called open again', async () => {
    // Saturday closed and left booked; then its 8:00 closed again, to cancel.
    const w = world({ a: booking('a') });
    const p = await preview(w, ['all']);
    const kept = await confirmClosure({ confirmToken: p.choices.keep!.confirmToken, choice: 'keep', confirmText: 'CANCEL' }, travis, w.deps(NOW));
    await finalizeClosure(kept.blackoutId, 'send-now', w.deps(minutes(1)), travis);
    const q = await preview(w, ['morning'], minutes(2));
    const morning = await confirmClosure({ confirmToken: q.choices.cancel!.confirmToken, choice: 'cancel', confirmText: 'CANCEL' }, travis, w.deps(minutes(2)));
    // While it waits, reopening the whole day would leave the 8:00 shut.
    assert.equal(await findStillClosed(kept.blackoutId, w.action(kept.blackoutId), { db: w.db }), 'some');
    const u = await undoClosure(morning.blackoutId, travis, { db: w.db, now: minutes(3) });
    assert.equal(u.kind === 'undone' && u.stillClosed, 'all');
    // Kept for a retried undo, and for Close a day hearing of it from another tab.
    assert.equal(w.action(morning.blackoutId).stillClosed, 'all');
    assert.deepEqual([...w.col('blackouts').keys()], [kept.blackoutId]);
    // Then the whole day reopened: nothing else covers it.
    w.col('blackouts').delete(kept.blackoutId);
    assert.equal(await findStillClosed(kept.blackoutId, w.action(kept.blackoutId), { db: w.db }), null);

    // The other way round: the 8:00 left booked, then the whole day closing.
    const v = world({ a: booking('a') });
    const vp = await preview(v, ['morning']);
    const vKept = await confirmClosure({ confirmToken: vp.choices.keep!.confirmToken, choice: 'keep', confirmText: 'CANCEL' }, travis, v.deps(NOW));
    await finalizeClosure(vKept.blackoutId, 'send-now', v.deps(minutes(1)), travis);
    const vq = await preview(v, ['all'], minutes(2));
    const day = await confirmClosure({ confirmToken: vq.choices.cancel!.confirmToken, choice: 'cancel', confirmText: 'CANCEL' }, travis, v.deps(minutes(2)));
    assert.equal(await findStillClosed(vKept.blackoutId, v.action(vKept.blackoutId), { db: v.db }), 'all');
    const vu = await undoClosure(day.blackoutId, travis, { db: v.db, now: minutes(3) }, 'reopen');
    // The 8:00 and the whole-day charter stay closed; the rest is open again.
    assert.equal(vu.kind === 'undone' && vu.stillClosed, 'some');
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

    // They finish paying during the window: confirmed, but not sent the
    // confirmation, since the closure is about to email them. Travis hears,
    // in case he undoes it.
    const paid = await payCheckout(w, 'hold');
    assert.equal(paid.outcome, 'confirmed');
    assert.deepEqual(paid.confirmations, []);
    assert.deepEqual(paid.closedAlerts, [{ kind: 'closing', choice: 'offer' }]);

    const done = await finalizeDueClosures(w.deps(minutes(10)));
    assert.deepEqual(done.finalized, [r.blackoutId]);
    const hold = w.col('bookings').get('hold')!;
    assert.equal(hold.status, 'confirmed');
    assert.equal((hold.closure as { blackoutId: string }).blackoutId, r.blackoutId);
    assert.deepEqual(w.sent.map((s) => s.to).sort(), ['a@example.com', 'hold@example.com']);
    assert.ok(w.sent.every((s) => /pick a new date or a refund/.test(s.subject)));
    assert.match(w.crewEmails[0]!.subject, /^\[CRMF\] Weather cancel: Sat Oct 17, 8:00 \(4 guests\)$/);
  });

  test('a checkout paid on a day left booked is confirmed for Travis to call, not sent the confirmation', async () => {
    const w = world({
      a: booking('a'),
      hold: booking('hold', {
        status: 'pending-payment',
        paymentStatus: 'pending',
        amountPaidCents: 0,
        stripePaymentIntentId: undefined,
        stripeCheckoutSessionId: 'cs_1',
      }),
    });
    const p = await preview(w);
    const r = await confirmClosure({ confirmToken: p.choices.keep!.confirmToken, choice: 'keep', confirmText: 'CANCEL' }, travis, w.deps(NOW));
    const during = await payCheckout(w, 'hold');
    assert.deepEqual(during.confirmations, []);
    assert.deepEqual(during.closedAlerts, [{ kind: 'closed' }]);

    const done = await finalizeClosure(r.blackoutId, 'send-now', w.deps(minutes(1)), travis);
    assert.equal(done.kind, 'finalized');
    assert.deepEqual(w.sent, [], 'nobody is emailed on a day left booked');
    assert.deepEqual(w.col('bookings').get('hold')!.status, 'confirmed');
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
    // Closing the trip is the bad news, as the preview showed: not the
    // plain wording of Travis cancelling one booking.
    const email = w.sent.find((s) => s.to === 'a@example.com')!;
    assert.equal(email.subject, 'Your Saturday, Oct 17 tour was cancelled by Capt. Travis');
    assert.match(email.text, /Travis had to cancel your tour on Saturday, October 17, 2026\. Sorry to break the news/);
    assert.equal(p.choices.cancel!.emails[0]!.subject, email.subject);
    assert.deepEqual(w.crewEmails.map((e) => e.to).sort(), ['faith@example.com', 'lacy@example.com']);
    assert.equal(w.crewEmails[0]!.subject, '[CRMF] Weather cancel: Sat Oct 17, 8:00 and 10:30 (7 guests)');
    assert.deepEqual(w.pushes, [
      { title: 'Weather cancel: Sat Oct 17', body: '8:00 and 10:30 are off · 7 guests', url: '/crew', tag: `closure-${r.blackoutId}` },
    ]);
  });

  test('cancel counts a checkout still being paid for apart, and marks it failed so Reports leave it out', async () => {
    const w = world({
      a: booking('a'),
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
    const r = await confirmClosure({ confirmToken: p.choices.cancel!.confirmToken, choice: 'cancel', confirmText: 'CANCEL' }, travis, w.deps(NOW));
    const f = await finalizeClosure(r.blackoutId, 'send-now', w.deps(minutes(2)), travis);

    assert.equal(f.kind, 'finalized');
    assert.equal(w.col('bookings').get('a')!.paymentStatus, 'refunded');
    assert.equal(w.col('bookings').get('hold')!.status, 'cancelled');
    assert.equal(w.col('bookings').get('hold')!.paymentStatus, 'failed');
    assert.deepEqual(closureReport('cancel', w.action(r.blackoutId).result!).summary, [
      'Cancelled 1 booking and emailed the customer.',
      'Cancelled 1 unfinished checkout.',
      '$168 is going back to their cards.',
    ]);
    // For Activity's sentence.
    const audit = w.audits.find((a) => a.action === 'closure.finalize')!;
    assert.deepEqual([...(audit.payload!.cancelledBookingIds as string[])].sort(), ['a', 'hold']);
    assert.deepEqual(audit.payload!.unpaidCheckoutIds, ['hold']);
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

    // The webhook confirms it, sending nothing: the retry cancels and
    // refunds it, and the cancellation is the one email they get.
    const paid = await payCheckout(w, 'hold');
    assert.equal(paid.outcome, 'confirmed');
    assert.equal(w.col('bookings').get('hold')!.status, 'confirmed');
    assert.deepEqual(paid.confirmations, []);
    assert.deepEqual(paid.closedAlerts, []);
    const retry = await finalizeDueClosures(w.deps(minutes(12)));
    assert.deepEqual(retry.finalized, [r.blackoutId]);
    assert.equal(w.col('bookings').get('hold')!.status, 'cancelled');
    assert.deepEqual(w.refunds.created, [{ amount: 16800, key: 'blackout-cancel-hold' }]);
    assert.deepEqual(w.sent.map((s) => s.to), ['hold@example.com']);
    assert.equal(w.action(r.blackoutId).state, 'done');
    assert.equal(w.pushes.length, 1);
  });

  test('offering a new date, a checkout paid while the offers go out is offered one too, not cancelled and refunded', async () => {
    const w = world({
      a: booking('a'),
      hold: booking('hold', {
        status: 'pending-payment',
        paymentStatus: 'pending',
        amountPaidCents: 0,
        stripePaymentIntentId: undefined,
        stripeCheckoutSessionId: 'cs_1',
      }),
    });
    const p = await preview(w);
    const r = await confirmClosure({ confirmToken: p.choices.offer!.confirmToken, choice: 'offer', confirmText: 'CANCEL' }, travis, w.deps(NOW));
    // While a's offer goes out, Stripe's webhook confirms hold, which the
    // run read as a checkout still being paid for.
    const deps = w.deps(minutes(10));
    const { stripe: completed, calls } = fakeStripe('complete');
    let paid: Awaited<ReturnType<typeof payCheckout>> | undefined;
    const mailer: CancellationMailer = {
      ...deps.mailer('travis@example.com'),
      async send(msg) {
        await deps.mailer('travis@example.com').send(msg);
        if (!paid && msg.to === 'a@example.com') paid = await payCheckout(w, 'hold');
      },
    };
    const first = await finalizeClosure(r.blackoutId, 'scheduler', { ...deps, stripe: { ...completed, ...w.refunds.stripe } as never, mailer: () => mailer });
    assert.equal(paid?.outcome, 'confirmed');
    assert.equal(first.kind === 'finalized' && first.retrying, true);
    // Nothing went to Stripe for them, and they're still booked.
    assert.deepEqual(calls, []);
    assert.deepEqual(w.refunds.created, []);
    assert.equal(w.col('bookings').get('hold')!.status, 'confirmed');
    assert.equal(w.pushes.length, 0);

    // The retry offers them a new date like everyone else.
    const retry = await finalizeDueClosures(w.deps(minutes(12)));
    assert.deepEqual(retry.finalized, [r.blackoutId]);
    const hold = w.col('bookings').get('hold')!;
    assert.equal(hold.status, 'confirmed');
    assert.equal((hold.closure as { blackoutId?: string }).blackoutId, r.blackoutId);
    assert.deepEqual(w.refunds.created, []);
    assert.deepEqual(w.sent.map((s) => s.to).sort(), ['a@example.com', 'hold@example.com']);
    const result = w.action(r.blackoutId).result!;
    assert.deepEqual(result.offered.map((o) => o.id).sort(), ['a', 'hold']);
    assert.deepEqual(result.cancelled, []);
    assert.deepEqual(result.failed, []);
    assert.equal(w.pushes.length, 1);
  });

  test('cancelling the day, a checkout paid before its turn is counted as a booking, not an unfinished checkout', async () => {
    const w = world({
      a: booking('a'),
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
    const deps = w.deps(minutes(10));
    let paid = false;
    const mailer: CancellationMailer = {
      ...deps.mailer('travis@example.com'),
      async send(msg) {
        await deps.mailer('travis@example.com').send(msg);
        if (!paid && msg.to === 'a@example.com') paid = (await payCheckout(w, 'hold')).outcome === 'confirmed';
      },
    };
    await finalizeClosure(r.blackoutId, 'scheduler', { ...deps, mailer: () => mailer });
    assert.ok(paid);
    const result = w.action(r.blackoutId).result!;
    assert.deepEqual(
      result.cancelled.map((c) => [c.id, !!c.unpaidCheckout]).sort(),
      [['a', false], ['hold', false]],
    );
    assert.deepEqual(closureReport('cancel', result).summary, ['Cancelled 2 bookings and emailed each customer.', '$336 is going back to their cards.']);
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
    assert.equal(
      a.adminNotes,
      'Birthday\n2026-10-15: Back on this trip: you reopened the day after they were asked to pick a new date (closed for weather). If they cancel by 2026-10-20, they get a full refund, as the offer said.',
    );
    assert.equal(a.refundGraceUntil, '2026-10-20');
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
    assert.deepEqual(settled, { settled: [], failed: [], refused: [] });
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

  test('tried again once the trip has left, it lists the ones put back as gone, and the crew don’t hear they’re back on', async () => {
    const closure = { blackoutId: 'bo1', reason: 'Closed for weather', decideBy: '2026-10-20', offeredAt: Timestamp.fromMillis(1_000) };
    const told = { claimedAt: Timestamp.fromMillis(1_000), sentAt: Timestamp.fromMillis(1_000) };
    const offered = ['a', 'b', 'late'].map((id) => ({ id, customerName: `Guest ${id}`, timeSlot: 'morning', guests: 2, decideBy: '2026-10-20', emailed: true }));
    let commits = 0;
    const fs = fakeFirestore(
      {
        bookings: {
          a: booking('a', { closure }),
          b: booking('b', { closure, timeSlot: 'mid-morning' }),
          late: booking('late', { closure, timeSlot: 'late-afternoon', tourId: 'late-afternoon-shared' }),
        },
        blackouts: { bo1: { date: DAY, affectedSlots: ['all'] } },
        closureActions: {
          bo1: { state: 'done', date: DAY, affectedSlots: ['all'], choice: 'offer', crewAlert: told, result: { cancelled: [], offered, failed: [] } },
        },
        crew: { lacy: { name: 'Lacy', email: 'lacy@example.com' } },
      },
      {
        beforeCommit: () => {
          if (++commits === 2) throw new Error('Firestore unavailable');
        },
      },
    );
    await assert.rejects(restoreOfferedBookings('bo1', { db: fs.db, now: NOW }), /Firestore unavailable/);
    assert.deepEqual(fs.col('closureActions').get('bo1')!.restoredBookingIds, ['a']);

    // 12:00 on the day: the 8:00 and 10:30 have left, the 3:30 hasn't. a
    // is listed as gone: Travis never heard they were put back, and with
    // the day open their trip counts as having run, so he checks whether
    // they went. b, whose trip left while it waited, keeps choosing.
    const noon = new Date('2026-10-17T16:00:00Z');
    const retry = await restoreOfferedBookings('bo1', { db: fs.db, now: noon });
    assert.deepEqual(retry.map((r) => [r.id, !!r.left]), [['late', false], ['a', true]]);
    assert.ok(fs.col('bookings').get('b')!.closure);
    // The crew hear only that the 3:30 is back on, not the 8:00 that has left.
    const subjects: string[] = [];
    const crew = { push: async () => {}, email: async ({ subject }: { subject: string }) => void subjects.push(subject) };
    assert.deepEqual(await alertCrewRestoredOnce('bo1', retry, { db: fs.db, crew, now: noon, baseUrl: 'https://example.com' }), { told: true });
    assert.deepEqual(subjects, ['[CRMF] Back on: Sat Oct 17, 3:30 (2 guests)']);
    // The day after, both are listed as gone.
    const nextDay = await restoreOfferedBookings('bo1', { db: fs.db, now: new Date('2026-10-18T13:00:00Z') });
    assert.deepEqual(nextDay.map((r) => [r.id, !!r.left]), [['a', true], ['late', true]]);
  });

  test('the crew email skips anyone with crew emails off, and so does the back-on one', async () => {
    const w = world(
      { a: booking('a') },
      { crew: { lacy: { name: 'Lacy', email: 'lacy@example.com' }, faith: { name: 'Faith', email: 'faith@example.com', alertsOn: false } } },
    );
    const id = await offer(w, ['all']);
    assert.deepEqual(w.crewEmails.map((e) => e.to), ['lacy@example.com']);
    assert.deepEqual(w.action(id).crewAlert?.failedCrewIds, []);

    const restored = await restoreOfferedBookings(id, { db: w.db, now: minutes(30) });
    const deps = { db: w.db, crew: w.deps(NOW).crew, now: minutes(30), baseUrl: 'https://example.com' };
    assert.deepEqual(await alertCrewRestoredOnce(id, restored, deps), { told: true });
    assert.deepEqual(w.crewEmails.map((e) => e.to), ['lacy@example.com', 'lacy@example.com']);
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

  test('reopening one closure while a later one waits, then undoing that: the booking goes back on, and the crew hear', async () => {
    const w = world({ x: booking('x') });
    // The morning closes and goes out: X is asked to pick a new date.
    const morning = await offer(w, ['morning']);
    assert.equal(w.pushes.length, 1);
    // Then the whole day, still in its undo window.
    const p = await preview(w, ['all'], minutes(2));
    const day = await confirmClosure({ confirmToken: p.choices.offer!.confirmToken, choice: 'offer', confirmText: 'CANCEL' }, travis, w.deps(minutes(2)));
    assert.equal(day.state, 'pending');
    // Reopening the morning skips X: the whole day still covers the 8:00.
    const crewDeps = { db: w.db, crew: w.deps(NOW).crew, now: minutes(3), baseUrl: 'https://example.com' };
    assert.equal((await undoClosure(morning, travis, { db: w.db, now: minutes(3) }, 'reopen')).kind, 'too-late');
    assert.deepEqual(await restoreOfferedBookings(morning, { db: w.db, now: minutes(3) }), []);
    w.col('blackouts').delete(morning);
    assert.equal(await alertCrewRestoredOnce(morning, [], crewDeps), null);

    // Undoing the whole day leaves nothing holding X off the 8:00.
    const u = await undoClosure(day.blackoutId, travis, { db: w.db, now: minutes(4) });
    assert.equal(u.kind, 'undone');
    const back = u.kind === 'undone' ? u.restored : [];
    assert.deepEqual(back, [{ id: 'x', customerName: 'Guest x', date: DAY, timeSlot: 'morning', guests: 2 }]);
    assert.equal(w.col('blackouts').size, 0);
    assert.equal(w.col('bookings').get('x')!.closure, undefined);
    assert.match(String(w.col('bookings').get('x')!.adminNotes), /Back on this trip/);
    assert.deepEqual(w.action(day.blackoutId).restoredBookingIds, ['x']);

    // The crew heard the 8:00 was off from the morning's alert, so they
    // hear it's back on, replacing that push. Once.
    assert.deepEqual(await alertCrewRestoredOnce(day.blackoutId, back, { ...crewDeps, now: minutes(4) }), { told: true });
    assert.deepEqual(w.pushes[1], { title: 'Back on: Sat Oct 17', body: '8:00 is going out after all · 2 guests', url: '/crew', tag: `closure-${morning}` });
    assert.equal(w.crewEmails[2]!.subject, '[CRMF] Back on: Sat Oct 17, 8:00 (2 guests)');
    assert.deepEqual(await alertCrewRestoredOnce(day.blackoutId, back, { ...crewDeps, now: minutes(5) }), { told: true });
    assert.equal(w.pushes.length, 2);
    assert.equal(w.crewEmails.length, 4);

    // A retried undo still lists X, from the closure's record.
    assert.deepEqual(await restoreOfferedBookings(day.blackoutId, { db: w.db, now: minutes(5) }), back);

    // And X isn't refunded once the morning's deadline passes.
    const d = w.deps(new Date('2026-10-21T10:30:00Z'));
    const settled = await settleExpiredClosures({ db: w.db, stripe: d.stripe, mailer: d.mailer('travis@example.com'), now: d.now });
    assert.deepEqual(settled, { settled: [], failed: [], refused: [] });
    assert.equal(w.col('bookings').get('x')!.status, 'confirmed');
    assert.equal(w.refunds.created.length, 0);
  });

  test('put back by a reopen or an undo, they keep the full refund until the deadline of the offer they were sent', async () => {
    // A reopen: the offer's deadline, 3 days after the closed date.
    const w = world({ a: booking('a') });
    const id = await offer(w, ['all']);
    assert.equal((w.col('bookings').get('a')!.closure as { decideBy: string }).decideBy, '2026-10-20');
    await restoreOfferedBookings(id, { db: w.db, now: minutes(30) });
    assert.equal(w.col('bookings').get('a')!.refundGraceUntil, '2026-10-20');

    // An undo: the deadline of the earlier closure that offered them, not
    // of the one being undone, which nobody was sent.
    const u = world({ x: booking('x') });
    const morning = await offer(u, ['morning']);
    const p = await preview(u, ['all'], minutes(2));
    const day = await confirmClosure({ confirmToken: p.choices.offer!.confirmToken, choice: 'offer', confirmText: 'CANCEL' }, travis, u.deps(minutes(2)));
    u.col('closureActions').set(day.blackoutId, { ...u.col('closureActions').get(day.blackoutId), decideBy: '2026-10-23' });
    assert.deepEqual(await restoreOfferedBookings(morning, { db: u.db, now: minutes(3) }), []);
    u.col('blackouts').delete(morning);
    const undone = await undoClosure(day.blackoutId, travis, { db: u.db, now: minutes(4) });
    assert.deepEqual(undone.kind === 'undone' && undone.restored.map((r) => r.id), ['x']);
    const x = u.col('bookings').get('x')!;
    assert.equal(x.closure, undefined);
    assert.equal(x.refundGraceUntil, '2026-10-20');
    assert.match(String(x.adminNotes), /If they cancel by 2026-10-20, they get a full refund, as the offer said\.$/);
  });

  test('put back a second time, they keep the later of the two deadlines', async () => {
    const closure = { blackoutId: 'bo1', reason: 'Closed for weather', decideBy: '2026-10-20', offeredAt: Timestamp.fromMillis(1_000) };
    const fs = fakeFirestore({
      bookings: {
        later: booking('later', { closure, refundGraceUntil: '2026-10-22' }),
        earlier: booking('earlier', { closure, timeSlot: 'mid-morning', refundGraceUntil: '2026-10-18' }),
      },
      blackouts: { bo1: { date: DAY, affectedSlots: ['all'] } },
    });
    await restoreOfferedBookings('bo1', { db: fs.db, now: NOW });
    assert.equal(fs.col('bookings').get('later')!.refundGraceUntil, '2026-10-22');
    assert.equal(fs.col('bookings').get('earlier')!.refundGraceUntil, '2026-10-20');
  });

  test('an undo leaves alone anyone whose own closed day still stands', async () => {
    const w = world({ x: booking('x') });
    const morning = await offer(w, ['morning']);
    const p = await preview(w, ['all'], minutes(2));
    const day = await confirmClosure({ confirmToken: p.choices.offer!.confirmToken, choice: 'offer', confirmText: 'CANCEL' }, travis, w.deps(minutes(2)));
    const u = await undoClosure(day.blackoutId, travis, { db: w.db, now: minutes(3) });
    assert.deepEqual(u.kind === 'undone' && u.restored, []);
    assert.equal((w.col('bookings').get('x')!.closure as { blackoutId: string }).blackoutId, morning);
    assert.equal(w.action(day.blackoutId).restoredBookingIds, undefined);
    const crewDeps = { db: w.db, crew: w.deps(NOW).crew, now: minutes(3), baseUrl: 'https://example.com' };
    assert.equal(await alertCrewRestoredOnce(day.blackoutId, [], crewDeps), null);
    assert.equal(w.pushes.length, 1);
  });

  test('a day left booked: the crew, told it was closed, hear it’s back on when it reopens', async () => {
    const w = world({
      a: booking('a'),
      gone: booking('gone', { timeSlot: 'mid-morning', tourId: 'mid-morning-shared', stripePaymentIntentId: 'pi_2' }),
    });
    const p = await preview(w, ['all']);
    const r = await confirmClosure({ confirmToken: p.choices.keep!.confirmToken, choice: 'keep', confirmText: 'CANCEL' }, travis, w.deps(NOW));
    await finalizeClosure(r.blackoutId, 'send-now', w.deps(minutes(1)), travis);
    assert.equal(w.pushes[0]!.title, 'Closed: Sat Oct 17');
    // Travis calls them; one cancels.
    w.col('bookings').set('gone', { ...w.col('bookings').get('gone'), status: 'cancelled' });

    // Nobody to put back: the bookings were never touched.
    const restored = await restoreOfferedBookings(r.blackoutId, { db: w.db, now: minutes(30) });
    assert.deepEqual(restored, []);
    const texts: string[] = [];
    const crew = {
      push: w.deps(NOW).crew.push,
      async email(msg: { to: string; subject: string; text: string }) {
        w.crewEmails.push({ to: msg.to, subject: msg.subject });
        texts.push(msg.text);
      },
    };
    const deps = { db: w.db, crew, now: minutes(30), baseUrl: 'https://example.com' };
    assert.deepEqual(await alertCrewRestoredOnce(r.blackoutId, restored, deps), { told: true });
    assert.deepEqual(w.pushes[1], { title: 'Back on: Sat Oct 17', body: '8:00 is going out after all · 2 guests', url: '/crew', tag: `closure-${r.blackoutId}` });
    assert.equal(w.crewEmails[2]!.subject, '[CRMF] Back on: Sat Oct 17, 8:00 (2 guests)');
    assert.match(texts[0]!, /The guests are still booked on them\./);
    // A retried reopen: nothing more goes out.
    assert.deepEqual(await alertCrewRestoredOnce(r.blackoutId, restored, deps), { told: true });
    assert.equal(w.pushes.length, 2);
  });

  test('a day left booked that nobody is still on: nothing to tell the crew', async () => {
    const w = world({ a: booking('a') });
    const p = await preview(w, ['all']);
    const r = await confirmClosure({ confirmToken: p.choices.keep!.confirmToken, choice: 'keep', confirmText: 'CANCEL' }, travis, w.deps(NOW));
    await finalizeClosure(r.blackoutId, 'send-now', w.deps(minutes(1)), travis);
    // Moved to another day.
    w.col('bookings').set('a', { ...w.col('bookings').get('a'), date: '2026-10-24' });
    const deps = { db: w.db, crew: w.deps(NOW).crew, now: minutes(30), baseUrl: 'https://example.com' };
    assert.equal(await alertCrewRestoredOnce(r.blackoutId, [], deps), null);
    assert.equal(w.pushes.length, 1);
  });

  test('a day left booked that another closed day still covers: the crew aren’t told it’s back on until that one goes', async () => {
    const w = world({ x: booking('x') });
    // The morning is closed and left booked, then the whole day.
    const keep = async (slots: string[], at: Date) => {
      const p = await preview(w, slots, at);
      const r = await confirmClosure({ confirmToken: p.choices.keep!.confirmToken, choice: 'keep', confirmText: 'CANCEL' }, travis, w.deps(at));
      await finalizeClosure(r.blackoutId, 'send-now', w.deps(at), travis);
      return r.blackoutId;
    };
    const morning = await keep(['morning'], NOW);
    const day = await keep(['all'], minutes(2));
    assert.equal(w.pushes.length, 2);
    const reopen = async (id: string, at: Date) => {
      const restored = await restoreOfferedBookings(id, { db: w.db, now: at });
      w.col('blackouts').delete(id);
      return alertCrewRestoredOnce(id, restored, { db: w.db, crew: w.deps(at).crew, now: at, baseUrl: 'https://example.com' });
    };

    // The whole day is still closed: the 8:00 isn't going out.
    assert.equal(await reopen(morning, minutes(10)), null);
    assert.equal(w.pushes.length, 2);
    // Now it is.
    assert.deepEqual(await reopen(day, minutes(11)), { told: true });
    assert.deepEqual(w.pushes[2], { title: 'Back on: Sat Oct 17', body: '8:00 is going out after all · 2 guests', url: '/crew', tag: `closure-${day}` });
  });

  test('a day closed from MCP coming down puts back people an earlier closure called off, and the crew hear, once', async () => {
    const w = world({ x: booking('x') });
    const morning = await offer(w, ['morning']);
    assert.equal(w.pushes.length, 1);
    // From MCP: a blackout with no closure of its own.
    w.col('blackouts').set('mcp1', { date: DAY, affectedSlots: ['all'], reason: 'weather', notes: null });
    const crewDeps = (at: Date) => ({ db: w.db, crew: w.deps(at).crew, now: at, baseUrl: 'https://example.com' });

    // Reopening the morning leaves X off: the MCP blackout still covers the 8:00.
    assert.deepEqual(await restoreOfferedBookings(morning, { db: w.db, now: minutes(5) }), []);
    w.col('blackouts').delete(morning);
    assert.equal(await alertCrewRestoredOnce(morning, [], crewDeps(minutes(5))), null);

    // Taking the MCP one down puts X back, and the crew, told by the morning's alert, hear it.
    const back = await restoreOfferedBookings('mcp1', { db: w.db, now: minutes(6) });
    assert.deepEqual(back.map((r) => r.id), ['x']);
    w.col('blackouts').delete('mcp1');
    assert.deepEqual(await alertCrewRestoredOnce('mcp1', back, crewDeps(minutes(6))), { told: true });
    assert.deepEqual(w.pushes[1], { title: 'Back on: Sat Oct 17', body: '8:00 is going out after all · 2 guests', url: '/crew', tag: `closure-${morning}` });
    assert.equal(w.crewEmails[2]!.subject, '[CRMF] Back on: Sat Oct 17, 8:00 (2 guests)');
    assert.ok(w.action(morning).reopenCrewAlertsFor?.mcp1?.sentAt);
    assert.equal(w.action(morning).reopenCrewAlert, undefined);

    // Asked again: how it went, and nothing re-sent.
    assert.deepEqual(await alertCrewRestoredOnce('mcp1', back, crewDeps(minutes(7))), { told: true });
    assert.equal(w.pushes.length, 2);
    assert.equal(w.crewEmails.length, 4);
  });

  /** Closes the 8:00 on DAY with "leave them booked" and sends it: the crew hear it's closed. */
  async function keepMorning(w: ReturnType<typeof world>) {
    const p = await preview(w, ['morning']);
    const r = await confirmClosure({ confirmToken: p.choices.keep!.confirmToken, choice: 'keep', confirmText: 'CANCEL' }, travis, w.deps(NOW));
    await finalizeClosure(r.blackoutId, 'send-now', w.deps(minutes(1)), travis);
    assert.equal(w.pushes[0]!.title, 'Closed: Sat Oct 17');
    return r.blackoutId;
  }

  test('a day left booked, reopened while a day closed from MCP still covers it: the crew hear it’s back on when that one comes down, once', async () => {
    const w = world({ a: booking('a') });
    const kept = await keepMorning(w);
    const crewDeps = (at: Date) => ({ db: w.db, crew: w.deps(at).crew, now: at, baseUrl: 'https://example.com' });
    const mcp = (id: string, at: Date) =>
      w.col('blackouts').set(id, { date: DAY, affectedSlots: ['all'], reason: 'weather', notes: null, createdAt: Timestamp.fromDate(at) });
    // As adminDeleteBlackout takes one down: the blackout as it was, passed along.
    const takeDownMcp = async (id: string, at: Date) => {
      const blackout = w.col('blackouts').get(id) as never;
      const back = await restoreOfferedBookings(id, { db: w.db, now: at });
      w.col('blackouts').delete(id);
      return alertCrewRestoredOnce(id, back, { ...crewDeps(at), blackout });
    };
    mcp('mcp1', minutes(10));

    // Reopening the 8:00: the MCP one still covers it, so nothing yet.
    assert.deepEqual(await restoreOfferedBookings(kept, { db: w.db, now: minutes(20) }), []);
    w.col('blackouts').delete(kept);
    assert.equal(await alertCrewRestoredOnce(kept, [], crewDeps(minutes(20))), null);
    assert.equal(w.pushes.length, 1);

    // Taking the MCP one down: it's going out, and the crew hear it.
    assert.deepEqual(await takeDownMcp('mcp1', minutes(30)), { told: true });
    assert.deepEqual(w.pushes[1], { title: 'Back on: Sat Oct 17', body: '8:00 is going out after all · 2 guests', url: '/crew', tag: `closure-${kept}` });
    assert.equal(w.crewEmails[2]!.subject, '[CRMF] Back on: Sat Oct 17, 8:00 (2 guests)');
    assert.deepEqual(w.action(kept).reopenCrewAlertsFor?.mcp1?.bookingIds, ['a']);

    // Another day closed from MCP and taken down later: they've heard already.
    mcp('mcp2', minutes(40));
    assert.equal(await takeDownMcp('mcp2', minutes(50)), null);
    assert.equal(w.pushes.length, 2);
    assert.equal(w.crewEmails.length, 4);
  });

  test('a day left booked, reopened while another closing waits out its undo window, which is then undone: the crew hear', async () => {
    const w = world({ a: booking('a') });
    const kept = await keepMorning(w);
    const p = await preview(w, ['all'], minutes(2));
    const day = await confirmClosure({ confirmToken: p.choices.cancel!.confirmToken, choice: 'cancel', confirmText: 'CANCEL' }, travis, w.deps(minutes(2)));
    assert.equal(day.state, 'pending');
    const crewDeps = (at: Date) => ({ db: w.db, crew: w.deps(at).crew, now: at, baseUrl: 'https://example.com' });

    // The whole day still covers the 8:00.
    assert.equal((await undoClosure(kept, travis, { db: w.db, now: minutes(3) }, 'reopen')).kind, 'too-late');
    assert.deepEqual(await restoreOfferedBookings(kept, { db: w.db, now: minutes(3) }), []);
    w.col('blackouts').delete(kept);
    assert.equal(await alertCrewRestoredOnce(kept, [], crewDeps(minutes(3))), null);

    // Undone: nothing holds the 8:00 now.
    const u = await undoClosure(day.blackoutId, travis, { db: w.db, now: minutes(4) });
    assert.deepEqual(u.kind === 'undone' && u.restored, []);
    assert.deepEqual(await alertCrewRestoredOnce(day.blackoutId, [], crewDeps(minutes(4))), { told: true });
    assert.deepEqual(w.pushes[1], { title: 'Back on: Sat Oct 17', body: '8:00 is going out after all · 2 guests', url: '/crew', tag: `closure-${kept}` });
    assert.deepEqual(w.action(day.blackoutId).reopenCrewAlert?.bookingIds, ['a']);
    assert.equal(w.pushes.length, 2);
  });
});

describe('a trip that has left with people still booked on it', () => {
  // On the day: 11:00 AM and noon at the marina (EDT).
  const ELEVEN = new Date('2026-10-17T15:00:00Z');
  const NOON = new Date('2026-10-17T16:00:00Z');

  /** Closes the whole of DAY, leaving everyone booked, and sends it. */
  async function keepDay(w: ReturnType<typeof world>) {
    const p = await preview(w, ['all']);
    const r = await confirmClosure({ confirmToken: p.choices.keep!.confirmToken, choice: 'keep', confirmText: 'CANCEL' }, travis, w.deps(NOW));
    await finalizeClosure(r.blackoutId, 'send-now', w.deps(minutes(1)), travis);
    return { id: r.blackoutId, blackout: w.col('blackouts').get(r.blackoutId) as { date: string; affectedSlots: string[] } };
  }

  test('reopening the day to run a later trip is refused while an earlier one has left with someone still booked on it', async () => {
    const w = world({
      a: booking('a'),
      later: booking('later', { timeSlot: 'early-afternoon', tourId: 'early-afternoon-shared' }),
    });
    const { id, blackout } = await keepDay(w);

    // 11:00: the 1:00 can go after all, but the 8:00 left with a on it.
    await assert.rejects(
      assertReopenable(id, blackout, { db: w.db, now: ELEVEN }),
      (err: unknown) =>
        err instanceof ClosureError &&
        err.status === 409 &&
        err.message ===
          'The 8:00 AM trip on Sat Oct 17 has already left with Guest a still booked, so reopening now would count it as a trip that ran. ' +
            'Open that booking: if the trip went out after all, mark it “It went out after all”; if it didn’t, move or cancel it. Then reopen.',
    );
    // Before the 8:00 left, nothing in the way.
    await assertReopenable(id, blackout, { db: w.db, now: new Date('2026-10-17T11:30:00Z') });

    // It went out after all: marked on its own, the day still closed. Now it reopens.
    assert.deepEqual(await adminMarkOne('a', 'completed', { db: w.db, now: ELEVEN, ranAnyway: true }), { kind: 'marked', closedBy: [id] });
    await assertReopenable(id, blackout, { db: w.db, now: ELEVEN });
  });

  test('a moved, cancelled or no-show booking, one still choosing, or a trip another closed day covers doesn’t stop it', async () => {
    const closure = { blackoutId: 'bo0', reason: 'Closed for weather', decideBy: '2026-10-20', offeredAt: Timestamp.fromMillis(1_000) };
    const w = world({
      moved: booking('moved'),
      cancelled: booking('cancelled', { timeSlot: 'mid-morning', tourId: 'mid-morning-shared' }),
      noShow: booking('noShow', { status: 'no-show' }),
      choosing: booking('choosing', { closure }),
      checkout: booking('checkout', { status: 'pending-payment', paymentStatus: 'pending', amountPaidCents: 0 }),
    });
    const { id, blackout } = await keepDay(w);
    w.col('bookings').set('moved', { ...w.col('bookings').get('moved'), date: '2026-10-24' });
    w.col('bookings').set('cancelled', { ...w.col('bookings').get('cancelled'), status: 'cancelled' });
    await assertReopenable(id, blackout, { db: w.db, now: NOON });

    // Someone still on the 8:00 and the 10:30, but a day closed from MCP still covers the 8:00.
    w.col('bookings').set('a', booking('a'));
    w.col('bookings').set('m', booking('m', { timeSlot: 'mid-morning', tourId: 'mid-morning-shared', customerName: '' }));
    w.col('blackouts').set('mcp1', { date: DAY, affectedSlots: ['morning'] });
    await assert.rejects(
      assertReopenable(id, blackout, { db: w.db, now: NOON }),
      /The 10:30 AM trip on Sat Oct 17 has already left with a booking with no name still booked, so reopening now would count it as a trip that ran\./,
    );
    w.col('blackouts').delete('mcp1');
    await assert.rejects(
      assertReopenable(id, blackout, { db: w.db, now: NOON }),
      /The 8:00 AM and 10:30 AM trips on Sat Oct 17 have already left with Guest a and a booking with no name still booked, so reopening now would count them as trips that ran\. Open each booking: /,
    );
  });

  test('an undo after a trip it covers has left goes ahead, and names who was still booked on it', async () => {
    const w = world({ a: booking('a'), later: booking('later', { timeSlot: 'early-afternoon', tourId: 'early-afternoon-shared' }) });
    // 7:55 AM on the day: the whole day, with the 10-minute undo window.
    const p = await preview(w, ['all'], new Date('2026-10-17T11:55:00Z'));
    const r = await confirmClosure({ confirmToken: p.choices.offer!.confirmToken, choice: 'offer', confirmText: 'CANCEL' }, travis, w.deps(new Date('2026-10-17T11:55:00Z')));
    assert.equal(r.state, 'pending');

    // 8:02: the 8:00 has gone, and while the closing is pending it can't be
    // marked as having gone out after all. Undone, it counts as having run.
    const eightOhTwo = new Date('2026-10-17T12:02:00Z');
    assert.deepEqual(await adminMarkOne('a', 'no-show', { db: w.db, now: eightOhTwo, ranAnyway: true }), { kind: 'closing' });
    const u = await undoClosure(r.blackoutId, travis, { db: w.db, now: eightOhTwo, audit: w.deps(NOW).audit });
    assert.equal(u.kind, 'undone');
    assert.deepEqual(u.kind === 'undone' && u.alreadyLeft, [{ id: 'a', customerName: 'Guest a', date: DAY, timeSlot: 'morning', guests: 2 }]);
    assert.equal(w.col('blackouts').size, 0);
    // A retried undo finds them the same way.
    assert.deepEqual((await findLeftStillBooked(r.blackoutId, w.action(r.blackoutId), { db: w.db, now: eightOhTwo })).map((l) => l.id), ['a']);
    // Nothing was sent, and it can be marked the usual way now.
    assert.equal(w.sent.length, 0);
    assert.deepEqual(await adminMarkOne('a', 'no-show', { db: w.db, now: eightOhTwo }), { kind: 'marked' });
  });
});

describe('a day closed from MCP', () => {
  test('with people going out on it, the crew get the "Closed" alert, once, and hear it’s back on when it comes down', async () => {
    const w = world(
      {
        a: booking('a'),
        // Still in Stripe checkout: if they pay, the crew hear of it as a new booking on a closed trip.
        hold: booking('hold', { status: 'pending-payment', paymentStatus: 'pending', amountPaidCents: 0, stripePaymentIntentId: undefined }),
        open: booking('open', { timeSlot: 'late-afternoon', tourId: 'late-afternoon-shared' }),
      },
      {
        crew: { lacy: { name: 'Lacy', email: 'lacy@example.com' }, faith: { name: 'Faith', email: 'faith@example.com', alertsOn: false } },
        blackouts: { mcp1: { date: DAY, affectedSlots: ['morning'], reason: 'weather', notes: null, createdAt: Timestamp.fromDate(NOW) } },
      },
    );
    const crew = w.deps(NOW).crew;
    assert.deepEqual(await alertCrewClosedFromMcp('mcp1', { db: w.db, crew, now: NOW, baseUrl: 'https://example.com' }), { told: true });
    assert.deepEqual(w.pushes, [
      { title: 'Closed: Sat Oct 17', body: '8:00 closed · 2 guests booked, Travis is contacting them', url: '/crew', tag: 'closure-mcp1' },
    ]);
    assert.deepEqual(w.crewEmails, [{ to: 'lacy@example.com', subject: '[CRMF] Closed: Sat Oct 17, 8:00 (2 guests)' }]);
    assert.ok((w.col('blackouts').get('mcp1')!.crewAlert as { sentAt?: unknown }).sentAt);
    // Whom it left booked, with no names: the crew app lists the trip as called off once they're all gone.
    assert.deepEqual((w.col('blackouts').get('mcp1')!.crewAlert as { kept?: unknown }).kept, [{ id: 'a', timeSlot: 'morning', guests: 2 }]);
    // Once per blackout.
    assert.equal(await alertCrewClosedFromMcp('mcp1', { db: w.db, crew, now: minutes(1), baseUrl: 'https://example.com' }), null);
    assert.equal(w.pushes.length + w.crewEmails.length, 2);

    // Taken down, as adminDeleteBlackout does: the crew heard it was closed, so they hear it's back on.
    const blackout = w.col('blackouts').get('mcp1') as never;
    assert.deepEqual(await restoreOfferedBookings('mcp1', { db: w.db, now: minutes(30) }), []);
    w.col('blackouts').delete('mcp1');
    assert.deepEqual(await alertCrewRestoredOnce('mcp1', [], { db: w.db, crew, now: minutes(30), baseUrl: 'https://example.com', blackout }), { told: true });
    assert.deepEqual(w.pushes[1], { title: 'Back on: Sat Oct 17', body: '8:00 is going out after all · 2 guests', url: '/crew', tag: 'closure-mcp1' });
    assert.deepEqual(w.crewEmails[1], { to: 'lacy@example.com', subject: '[CRMF] Back on: Sat Oct 17, 8:00 (2 guests)' });
  });

  test('with nobody going out on it, the crew aren’t told anything', async () => {
    const w = world(
      { hold: booking('hold', { status: 'pending-payment', paymentStatus: 'pending', amountPaidCents: 0, stripePaymentIntentId: undefined }) },
      { blackouts: { mcp1: { date: DAY, affectedSlots: ['all'], reason: 'weather', notes: null, createdAt: Timestamp.fromDate(NOW) } } },
    );
    assert.equal(await alertCrewClosedFromMcp('mcp1', { db: w.db, crew: w.deps(NOW).crew, now: NOW, baseUrl: 'https://example.com' }), null);
    assert.equal(w.pushes.length + w.crewEmails.length, 0);
    assert.equal(w.col('blackouts').get('mcp1')!.crewAlert, undefined);
  });
});

describe('what the crew and customers heard while it was closed', () => {
  const held = { claimedAt: Timestamp.fromMillis(500), sentAt: Timestamp.fromMillis(500) };
  // 7:55 PM at the marina the evening before.
  const EVE = new Date('2026-10-16T23:55:00Z');
  const after = (n: number) => new Date(EVE.getTime() + n * 60_000);
  const crewDeps = (w: ReturnType<typeof world>, at: Date) => ({ db: w.db, crew: w.deps(at).crew, now: at, baseUrl: 'https://example.com' });

  test('an undo after the 8 PM schedule said it was being called off tells the crew it’s back on, once', async () => {
    const w = world({
      a: booking('a', { guestCount: 4, confirmationEmailSentAt: held.sentAt }),
      'legacy-3': booking('legacy-3', { status: 'pending-payment', guestCount: 0, legacy: { bookingId: 3 }, stripePaymentIntentId: undefined }),
      later: booking('later', { timeSlot: 'late-afternoon', tourId: 'late-afternoon-shared', confirmationEmailSentAt: held.sentAt }),
    });
    const p = await preview(w, ['morning'], EVE);
    const r = await confirmClosure({ confirmToken: p.choices.cancel!.confirmToken, choice: 'cancel', confirmText: 'CANCEL' }, travis, w.deps(EVE));
    w.col('crewSchedules').set(DAY, { date: DAY, sentAt: Timestamp.fromDate(after(5)) });
    assert.equal((await undoClosure(r.blackoutId, travis, { db: w.db, now: after(8) })).kind, 'undone');

    assert.deepEqual(await alertCrewRestoredOnce(r.blackoutId, [], crewDeps(w, after(8))), { told: true });
    assert.deepEqual(w.pushes, [
      { title: 'Back on: Sat Oct 17', body: '8:00 is going out after all · 4+ guests', url: '/crew', tag: `closure-${r.blackoutId}` },
    ]);
    assert.deepEqual(w.crewEmails.map((e) => e.subject), ['[CRMF] Back on: Sat Oct 17, 8:00 (4+ guests)', '[CRMF] Back on: Sat Oct 17, 8:00 (4+ guests)']);
    assert.deepEqual(await alertCrewRestoredOnce(r.blackoutId, [], crewDeps(w, after(9))), { told: true });
    assert.equal(w.pushes.length, 1);
    // Nobody paid meanwhile: no confirmation to send.
    const c = await confirmPaidWhileClosed(r.blackoutId, { date: DAY, affectedSlots: ['morning'] }, { db: w.db, now: after(8), send: async () => assert.fail('nothing to send') });
    assert.deepEqual(c, { sent: [], failed: [] });

    // Schedule out before it closed: it said the trip was on, so nothing to correct.
    const v = world({ a: booking('a') }, { crewSchedules: { [DAY]: { date: DAY, sentAt: Timestamp.fromDate(EVE) } } });
    const pv = await preview(v, ['morning'], after(1));
    const rv = await confirmClosure({ confirmToken: pv.choices.cancel!.confirmToken, choice: 'cancel', confirmText: 'CANCEL' }, travis, v.deps(after(1)));
    await undoClosure(rv.blackoutId, travis, { db: v.db, now: after(2) });
    assert.equal(await alertCrewRestoredOnce(rv.blackoutId, [], crewDeps(v, after(2))), null);
  });

  test('someone who paid during the undo window: after an undo the crew hear it’s back on, and they get their confirmation, once', async () => {
    const w = world({
      a: booking('a', { confirmationEmailSentAt: held.sentAt }),
      hold: booking('hold', { status: 'pending-payment', paymentStatus: 'pending', amountPaidCents: 0, stripePaymentIntentId: undefined, stripeCheckoutSessionId: 'cs_1' }),
    });
    const p = await preview(w);
    const r = await confirmClosure({ confirmToken: p.choices.offer!.confirmToken, choice: 'offer', confirmText: 'CANCEL' }, travis, w.deps(NOW));
    const paid = await payCheckout(w, 'hold');
    assert.deepEqual(paid.confirmations, []);
    // Its crew email went out meanwhile: "New booking on a closed trip".
    w.col('bookings').set('hold', { ...w.col('bookings').get('hold'), crewAlertSentAt: { booked: Timestamp.fromDate(minutes(1)) } });
    assert.equal((await undoClosure(r.blackoutId, travis, { db: w.db, now: minutes(3) })).kind, 'undone');

    assert.deepEqual(await alertCrewRestoredOnce(r.blackoutId, [], crewDeps(w, minutes(3))), { told: true });
    assert.equal(w.pushes[0]!.body, '8:00 is going out after all · 4 guests');

    const sent: string[] = [];
    const send = async (id: string) => {
      sent.push(id);
      w.col('bookings').set(id, { ...w.col('bookings').get(id), confirmationEmailSentAt: Timestamp.fromDate(minutes(3)) });
    };
    const c = await confirmPaidWhileClosed(r.blackoutId, { date: DAY, affectedSlots: ['all'] }, { db: w.db, now: minutes(3), send });
    assert.deepEqual(c.sent, [{ id: 'hold', customerName: 'Guest hold', date: DAY, timeSlot: 'morning', guests: 2 }]);
    assert.deepEqual(c.failed, []);
    // A retried undo sends nobody a second one.
    await confirmPaidWhileClosed(r.blackoutId, { date: DAY, affectedSlots: ['all'] }, { db: w.db, now: minutes(4), send });
    assert.deepEqual(sent, ['hold']);
  });

  test('a day closed from MCP: once it’s down, someone who paid on it is confirmed and the crew hear, once', async () => {
    const createdAt = Timestamp.fromDate(NOW);
    const w = world(
      {
        a: booking('a', { confirmationEmailSentAt: held.sentAt }),
        late: booking('late', { crewAlertSentAt: { booked: Timestamp.fromDate(minutes(30)) } }),
        // Its own departure isn't closed.
        open: booking('open', { timeSlot: 'late-afternoon', tourId: 'late-afternoon-shared' }),
      },
      { blackouts: { mcp1: { date: DAY, affectedSlots: ['morning'], reason: 'weather', notes: null, createdAt } } },
    );
    const blackout = w.col('blackouts').get('mcp1') as never;
    w.col('blackouts').delete('mcp1');

    assert.deepEqual(await alertCrewRestoredOnce('mcp1', [], { ...crewDeps(w, minutes(60)), blackout }), { told: true });
    assert.deepEqual(w.pushes, [{ title: 'Back on: Sat Oct 17', body: '8:00 is going out after all · 4 guests', url: '/crew', tag: 'closure-mcp1' }]);
    // A retried reopen finds no blackout to pass, so nothing more goes out.
    assert.equal(await alertCrewRestoredOnce('mcp1', [], crewDeps(w, minutes(61))), null);
    assert.equal(w.pushes.length, 1);

    const sent: string[] = [];
    const c = await confirmPaidWhileClosed('mcp1', blackout, { db: w.db, now: minutes(60), send: async (id) => void sent.push(id) });
    assert.deepEqual(sent, ['late']);
    assert.deepEqual(c.failed, []);
  });

  test('a day left booked: the crew are told about who’s going out, not a checkout still being paid for or someone already choosing', async () => {
    const w = world({
      a: booking('a', { guestCount: 4 }),
      hold: booking('hold', { status: 'pending-payment', paymentStatus: 'pending', amountPaidCents: 0, stripePaymentIntentId: undefined, stripeCheckoutSessionId: 'cs_1' }),
      choosing: booking('choosing', { timeSlot: 'mid-morning', closure: { blackoutId: 'bo0', reason: 'Closed for weather', decideBy: '2026-10-20' } }),
      'legacy-4': booking('legacy-4', { timeSlot: 'mid-morning', status: 'pending-payment', guestCount: 0, legacy: { bookingId: 4 }, stripePaymentIntentId: undefined }),
    });
    const p = await preview(w);
    const r = await confirmClosure({ confirmToken: p.choices.keep!.confirmToken, choice: 'keep', confirmText: 'CANCEL' }, travis, w.deps(NOW));
    // The banner's count says which parties have no size on file.
    assert.deepEqual(w.action(r.blackoutId).summary, { bookings: 4, guests: 8, unknown: 1, departs: ['8:00 AM', '10:30 AM'] });
    const f = await finalizeClosure(r.blackoutId, 'send-now', w.deps(minutes(1)), travis);
    assert.deepEqual(f.kind === 'finalized' && f.result.kept!.map((k) => k.id), ['a', 'legacy-4']);
    assert.equal(w.crewEmails[0]!.subject, '[CRMF] Closed: Sat Oct 17, 8:00 and 10:30 (4+ guests)');
  });
});

describe('a closure a reopen left behind', () => {
  // Reopening a day used to only take the blackout down: everyone it had
  // offered a new date was left "choosing", and was told they'd be refunded
  // if they didn't pick by the deadline.
  const closure = { blackoutId: 'bo1', reason: 'Closed for weather', decideBy: '2026-10-20', offeredAt: Timestamp.fromMillis(1_000) };
  const offered = { state: 'done', date: DAY, affectedSlots: ['all'], choice: 'offer', crewAlert: { claimedAt: Timestamp.fromMillis(1_000), sentAt: Timestamp.fromMillis(1_000) } };
  const settle = (w: ReturnType<typeof world>, at: Date) => {
    const d = w.deps(at);
    return settleExpiredClosures({ db: w.db, stripe: d.stripe, mailer: d.mailer('travis@example.com'), now: at });
  };

  test('they still choose, and are refunded at the deadline, as that reopen promised', async () => {
    const w = world({ a: booking('a', { closure }) }, { closureActions: { bo1: offered } });
    assert.equal(await isStaleClosure(w.db, w.col('bookings').get('a') as never), true);

    // 6:00 AM on the day, and on the last day to choose: still choosing.
    assert.deepEqual(await settle(w, new Date('2026-10-17T10:00:00Z')), { settled: [], failed: [], refused: [] });
    assert.deepEqual(await settle(w, new Date('2026-10-20T10:00:00Z')), { settled: [], failed: [], refused: [] });
    assert.ok(w.col('bookings').get('a')!.closure);

    // 6:00 AM the day after.
    assert.deepEqual(await settle(w, new Date('2026-10-21T10:00:00Z')), { settled: ['a'], failed: [], refused: [] });
    assert.equal(w.col('bookings').get('a')!.status, 'cancelled');
    assert.equal(w.refunds.created.length, 1);
    assert.equal(w.sent.length, 1);
  });

  test('if they went out, Travis can mark the trip, which takes the closure off: nothing refunds them', async () => {
    const w = world(
      { a: booking('a', { closure, adminNotes: 'Birthday' }), b: booking('b', { closure }) },
      { closureActions: { bo1: offered } },
    );

    // 11:00 AM on the day: the 8:00 is back.
    const at = new Date('2026-10-17T15:00:00Z');
    assert.deepEqual(await adminMarkOne('a', 'completed', { db: w.db, now: at }), { kind: 'marked' });
    assert.deepEqual(await adminMarkOne('b', 'no-show', { db: w.db, now: at }), { kind: 'marked' });
    const a = w.col('bookings').get('a')!;
    assert.equal(a.closure, undefined);
    assert.equal(
      a.adminNotes,
      'Birthday\n2026-10-17: Marked completed after the day was reopened, so the offer of a new date or a refund (closed for weather) no longer applies.',
    );
    assert.equal(w.col('bookings').get('b')!.closure, undefined);

    assert.deepEqual(await settle(w, new Date('2026-10-21T10:00:00Z')), { settled: [], failed: [], refused: [] });
    assert.equal(w.col('bookings').get('a')!.status, 'completed');
    assert.equal(w.col('bookings').get('b')!.status, 'no-show');
    assert.equal(w.refunds.created.length, 0);
    assert.equal(w.sent.length, 0);
  });

  test('not left behind, so not markable: a trip another closed day covers, one this version reopened after it left, and one going out now', async () => {
    const w = world(
      {
        covered: booking('covered', { closure }),
        leftAlready: booking('leftAlready', { timeSlot: 'mid-morning', tourId: 'mid-morning-shared', closure: { ...closure, blackoutId: 'bo2' } }),
        goingOut: booking('goingOut', { timeSlot: 'early-afternoon', tourId: 'early-afternoon-shared', closure: { ...closure, blackoutId: 'bo3' } }),
      },
      {
        // From MCP, over the 8:00.
        blackouts: { mcp: { date: DAY, affectedSlots: ['morning'] } },
        closureActions: {
          bo1: offered,
          bo2: { ...offered, reopenedAt: Timestamp.fromMillis(2_000) },
          bo3: { ...offered, state: 'finalizing' },
        },
      },
    );
    for (const id of ['covered', 'leftAlready', 'goingOut']) {
      assert.equal(await isStaleClosure(w.db, w.col('bookings').get(id) as never), false, id);
      assert.deepEqual(await adminMarkOne(id, 'no-show', { db: w.db, now: new Date('2026-10-17T20:00:00Z') }), { kind: 'closed' }, id);
    }
    const r = await settle(w, new Date('2026-10-21T10:00:00Z'));
    assert.deepEqual(r.settled.sort(), ['covered', 'goingOut', 'leftAlready']);
  });

  test('reopened by this version after the trip had left, they still choose, are reminded, and are refunded', async () => {
    const w = world({ early: booking('early'), late: booking('late', { timeSlot: 'late-afternoon', tourId: 'late-afternoon-shared' }) });
    const p = await preview(w, ['all']);
    const r = await confirmClosure({ confirmToken: p.choices.offer!.confirmToken, choice: 'offer', confirmText: 'CANCEL' }, travis, w.deps(NOW));
    await finalizeClosure(r.blackoutId, 'send-now', w.deps(minutes(1)), travis);

    // 11:00 AM on the day: the 8:00 has left, the 3:30 hasn't.
    const at = new Date('2026-10-17T15:00:00Z');
    assert.deepEqual((await restoreOfferedBookings(r.blackoutId, { db: w.db, now: at })).map((b) => b.id), ['late']);
    w.col('blackouts').delete(r.blackoutId);
    assert.ok(w.action(r.blackoutId).reopenedAt);
    assert.equal(await isStaleClosure(w.db, w.col('bookings').get('early') as never), false);
    assert.deepEqual(await adminMarkOne('early', 'no-show', { db: w.db, now: at }), { kind: 'closed' });

    const settled = await settle(w, new Date('2026-10-21T10:00:00Z'));
    assert.deepEqual(settled, { settled: ['early'], failed: [], refused: [] });
    assert.equal(w.col('bookings').get('late')!.status, 'confirmed');
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
    assert.deepEqual(await alertCrewOnce('bo1', action, result, { db: w.db, crew, now: NOW, baseUrl: 'https://example.com' }), { sent: true, told: false });
    assert.deepEqual(await alertCrewOnce('bo1', action, result, { db: w.db, crew, now: NOW, baseUrl: 'https://example.com' }), { sent: false, told: false });
    assert.deepEqual(emails, ['faith@example.com']);
    const marker = w.action('bo1').crewAlert!;
    assert.deepEqual(marker.failedCrewIds, ['lacy']);
    assert.deepEqual(marker.emailedCrewIds, ['faith']);
    assert.equal(marker.subject, '[CRMF] Weather cancel: Sat Oct 17, 8:00 (6 guests)');
  });

  test('a party size the old site didn’t record isn’t counted as nobody', async () => {
    const w = world({}, { closureActions: { bo1: { state: 'finalizing' } } });
    const offered = (id: string, timeSlot: 'morning' | 'mid-morning', guests: number) => ({
      id,
      customerName: id,
      timeSlot,
      guests,
      decideBy: '2026-10-20',
      emailed: true,
    });
    const result = {
      cancelled: [],
      offered: [offered('a', 'morning', 2), offered('legacy-1', 'morning', 0), offered('legacy-2', 'mid-morning', 0)],
      failed: [],
    };
    const bodies: string[] = [];
    const texts: string[] = [];
    const crew = {
      push: async (msg: { body: string }) => {
        bodies.push(msg.body);
      },
      email: async (msg: { text: string }) => {
        texts.push(msg.text);
      },
    };
    const action = { date: DAY, reason: 'weather' as const, choice: 'offer' as const };
    await alertCrewOnce('bo1', action, result, { db: w.db, crew, now: NOW, baseUrl: 'https://example.com' });
    assert.equal(w.action('bo1').crewAlert!.subject, '[CRMF] Weather cancel: Sat Oct 17, 8:00 and 10:30 (2+ guests)');
    assert.deepEqual(bodies, ['8:00 and 10:30 are off · 2+ guests']);
    assert.match(texts[0]!, /8:00 AM morning: 2\+ guests/);
    assert.match(texts[0]!, /10:30 AM mid-morning: party size unknown/);
    assert.match(texts[0]!, /In all: 2\+ guests\./);
  });
});

/**
 * Travis cancelling a booking (from the booking page or by closing a day),
 * against in-memory stand-ins for Firestore, Stripe and email.
 * Run with `npm test` in functions/.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type Stripe from 'stripe';

import { adminCancelOne, keepRefusedCancelRefund, stripeRefusedRefund, type CancellationMailer } from '../src/lib/admin-cancel';
import { EmailSendError } from '../src/lib/email-log';
import { recordCompletedCheckout } from '../src/lib/checkout-completed';
import { serializeBooking } from '../src/fetchBooking';
import type { Booking } from '../src/lib/types';
import { TOKEN, fakeDb, fakeRefunds, fakeStripe, type Doc } from './fakes';

function stripeWithRefunds(
  status: Stripe.Checkout.Session['status'] = 'open',
  payment?: Parameters<typeof fakeRefunds>[0],
) {
  const { stripe, calls } = fakeStripe(status);
  const { stripe: refunding, created } = fakeRefunds(payment);
  const withRefunds = { ...stripe, ...refunding } as Pick<Stripe, 'checkout' | 'refunds'>;
  return { stripe: withRefunds, calls, refunds: created };
}

function mailer() {
  const sent: Array<{ to: string; subject: string; text: string }> = [];
  const m: CancellationMailer = {
    marina: { name: 'Marina', address: '1 Dock St' },
    phoneDisplay: '352-586-7792',
    async send({ to, subject, text }) {
      sent.push({ to, subject, text });
    },
  };
  return { mailer: m, sent };
}

const base: Doc = {
  tourId: 'morning-shared',
  tourName: 'Morning Shared',
  date: '2099-07-04',
  timeSlot: 'morning',
  type: 'shared',
  guestCount: 2,
  guests: [],
  customerName: 'Pat Example',
  customerEmail: 'pat@example.com',
  accessToken: TOKEN,
  amountRefundedCents: 0,
};

describe('adminCancelOne', () => {
  test('refunds a booking paid on this site through Stripe and emails the customer', async () => {
    const { db, store } = fakeDb({
      b1: { ...base, id: 'b1', status: 'confirmed', paymentStatus: 'paid', amountPaidCents: 26000, stripePaymentIntentId: 'pi_1' },
    });
    const { stripe, refunds } = stripeWithRefunds();
    const { mailer: m, sent } = mailer();

    const r = await adminCancelOne('b1', { reason: 'Weather', cause: 'admin' }, { db, stripe, mailer: m });

    assert.deepEqual(refunds, [{ amount: 26000, key: 'admin-cancel-b1' }]);
    assert.equal(r.kind, 'cancelled');
    if (r.kind !== 'cancelled') return;
    assert.equal(r.refundCents, 26000);
    assert.equal(r.manualRefundCents, 0);
    assert.equal(r.emailed, true);
    const after = store.get('b1')!;
    assert.equal(after.status, 'cancelled');
    assert.equal(after.paymentStatus, 'refunded');
    assert.equal(after.amountRefundedCents, 26000);
    assert.match(sent[0]!.text, /full refund of \$260 has been issued/);
  });

  test('a closure’s cancel carries its id, so it can tell its own from Travis’s', async () => {
    const { db, store } = fakeDb({
      b1: { ...base, id: 'b1', status: 'confirmed', paymentStatus: 'paid', amountPaidCents: 26000, stripePaymentIntentId: 'pi_1' },
      b2: { ...base, id: 'b2', status: 'confirmed', paymentStatus: 'paid', amountPaidCents: 26000, stripePaymentIntentId: 'pi_1' },
    });
    const { stripe } = stripeWithRefunds();
    const { mailer: m } = mailer();

    await adminCancelOne('b1', { reason: 'Closed for weather', cause: 'blackout', closureId: 'bo1' }, { db, stripe, mailer: m });
    await adminCancelOne('b2', { reason: null, cause: 'admin' }, { db, stripe, mailer: m });

    assert.equal(store.get('b1')!.cancelledByClosure, 'bo1');
    assert.equal(store.get('b1')!.closureRefundCents, 26000);
    assert.equal(store.get('b2')!.status, 'cancelled');
    assert.equal('cancelledByClosure' in store.get('b2')!, false);
    assert.equal('closureRefundCents' in store.get('b2')!, false);
  });

  test('a customer taking the closure’s refund is recorded as theirs; the deadline’s as Travis’s, the money the same', async () => {
    const closure = { blackoutId: 'bo1', reason: 'Closed for weather', decideBy: '2099-07-07' };
    const { db, store } = fakeDb({
      b1: { ...base, id: 'b1', status: 'confirmed', paymentStatus: 'paid', amountPaidCents: 26000, stripePaymentIntentId: 'pi_1', closure },
      b2: { ...base, id: 'b2', status: 'confirmed', paymentStatus: 'paid', amountPaidCents: 26000, stripePaymentIntentId: 'pi_1', closure },
    });
    const { stripe, refunds } = stripeWithRefunds();
    const { mailer: m, sent } = mailer();
    const expect = { date: '2099-07-04', timeSlot: 'morning', closureBlackoutId: 'bo1' };

    // As cancelBooking calls it, then settleClosedBookings.
    await adminCancelOne('b1', { reason: closure.reason, notifyCustomer: true, cause: 'blackout', expect, emailCause: 'refund-chosen', cancelledBy: 'customer' }, { db, stripe, mailer: m });
    await adminCancelOne('b2', { reason: closure.reason, notifyCustomer: true, cause: 'blackout', expect, emailCause: 'deadline-passed' }, { db, stripe, mailer: m });

    assert.equal(store.get('b1')!.cancelledBy, 'customer');
    assert.equal(store.get('b1')!.cancelRefundCents, 26000);
    assert.equal(store.get('b2')!.cancelledBy, 'admin');
    assert.equal('cancelRefundCents' in store.get('b2')!, false);
    // The same refund under the closure's key either way, and the same email.
    assert.deepEqual(refunds, [
      { amount: 26000, key: 'blackout-cancel-b1' },
      { amount: 26000, key: 'blackout-cancel-b2' },
    ]);
    assert.equal(sent.length, 2);
  });

  test('a closure’s cancel stamps only what it refunded, not a partial refund from before', async () => {
    const { db, store } = fakeDb({
      b1: { ...base, id: 'b1', status: 'confirmed', paymentStatus: 'partial-refund', amountPaidCents: 20000, amountRefundedCents: 5000, stripePaymentIntentId: 'pi_1' },
    });
    const { stripe } = stripeWithRefunds('open', { paymentIntent: 'pi_1', earlier: [{ amount: 5000 }] });
    const { mailer: m } = mailer();

    await adminCancelOne('b1', { reason: 'Closed for weather', notifyCustomer: true, cause: 'blackout', closureId: 'bo1' }, { db, stripe, mailer: m });

    assert.equal(store.get('b1')!.amountRefundedCents, 20000);
    assert.equal(store.get('b1')!.closureRefundCents, 15000);
  });

  test('an old-website booking records no refund, notes it for Travis, and is not emailed by default', async () => {
    const { db, store } = fakeDb({
      'legacy-412': {
        ...base,
        id: 'legacy-412',
        status: 'confirmed',
        paymentStatus: 'paid',
        amountPaidCents: 18000,
        adminNotes: 'Customer note: first time',
        legacy: { bookingId: 412 },
      },
    });
    const { stripe, refunds } = stripeWithRefunds();
    const { mailer: m, sent } = mailer();

    const r = await adminCancelOne('legacy-412', { reason: null, cause: 'admin' }, { db, stripe, mailer: m });

    assert.equal(refunds.length, 0, 'nothing to refund through Stripe');
    assert.equal(r.kind, 'cancelled');
    if (r.kind !== 'cancelled') return;
    assert.equal(r.refundCents, 0);
    assert.equal(r.manualRefundCents, 18000);
    assert.equal(r.emailed, false);
    assert.equal(sent.length, 0);
    const after = store.get('legacy-412')!;
    assert.equal(after.status, 'cancelled');
    assert.equal(after.paymentStatus, 'paid', 'must not claim a refund that never happened');
    assert.equal(after.amountRefundedCents, 0);
    // Kept apart, so Reports and the dashboard don't count it as kept.
    assert.equal(after.manualRefundCents, 18000);
    assert.match(String(after.adminNotes), /^Customer note: first time\n.*\$180 was paid on the old website\. Refund it by hand\.$/);
  });

  test('the customer’s booking page says Travis will refund old-website money, not that nothing was refunded', async () => {
    const { db, store } = fakeDb({
      'legacy-7': { ...base, id: 'legacy-7', status: 'confirmed', paymentStatus: 'paid', amountPaidCents: 9000, legacy: { bookingId: 7 } },
      b1: { ...base, id: 'b1', status: 'confirmed', paymentStatus: 'paid', amountPaidCents: 26000, stripePaymentIntentId: 'pi_1' },
    });
    const { stripe } = stripeWithRefunds();
    const { mailer: m } = mailer();

    await adminCancelOne('legacy-7', { reason: null, cause: 'admin' }, { db, stripe, mailer: m });
    await adminCancelOne('b1', { reason: null, cause: 'admin' }, { db, stripe, mailer: m });

    assert.equal(serializeBooking(store.get('legacy-7') as Booking).manualRefundCents, 9000);
    assert.equal(serializeBooking(store.get('b1') as Booking).manualRefundCents, 0);
    assert.equal('manualRefundCents' in store.get('b1')!, false, 'nothing owed by hand on a Stripe refund');
  });

  test('a reason Travis typed without emailing the customer stays off their booking page', async () => {
    const paid: Doc = { ...base, status: 'confirmed', paymentStatus: 'paid', amountPaidCents: 26000, stripePaymentIntentId: 'pi_1' };
    const { db, store } = fakeDb({
      quiet: { ...paid, id: 'quiet' },
      told: { ...paid, id: 'told' },
      closed: { ...paid, id: 'closed' },
      'legacy-3': { ...base, id: 'legacy-3', status: 'confirmed', paymentStatus: 'paid', amountPaidCents: 9000, legacy: { bookingId: 3 } },
    });
    const { stripe } = stripeWithRefunds();
    const { mailer: m, sent } = mailer();

    await adminCancelOne('quiet', { reason: 'Suspected chargeback', notifyCustomer: false, cause: 'admin' }, { db, stripe, mailer: m });
    await adminCancelOne('told', { reason: 'Boat trouble', notifyCustomer: true, cause: 'admin' }, { db, stripe, mailer: m });
    // A closure's reason is written for the customer, emailed or not.
    await adminCancelOne('closed', { reason: 'Closed for weather', notifyCustomer: false, cause: 'blackout' }, { db, stripe, mailer: m });
    // Old-site bookings aren't emailed unless Travis asks.
    await adminCancelOne('legacy-3', { reason: 'Owes us for last time', cause: 'admin' }, { db, stripe, mailer: m });

    assert.deepEqual(sent.map((s) => s.to), ['pat@example.com'], 'only "told" was emailed');
    const page = (id: string) => serializeBooking(store.get(id) as Booking).cancellationReason;
    assert.equal(page('quiet'), null);
    assert.equal(page('legacy-3'), null);
    assert.equal(page('told'), 'Boat trouble');
    assert.equal(page('closed'), 'Closed for weather');
    // Travis still has it on the booking.
    assert.equal(store.get('quiet')!.cancellationReason, 'Suspected chargeback');
    assert.equal(store.get('quiet')!.cancellationReasonPrivate, true);
    assert.equal('cancellationReasonPrivate' in store.get('told')!, false);
  });

  test('if Travis asks, the old-website customer is told he will refund them, never that it was issued', async () => {
    const { db } = fakeDb({
      'legacy-9': { ...base, id: 'legacy-9', status: 'confirmed', paymentStatus: 'paid', amountPaidCents: 9000, legacy: { bookingId: 9 } },
    });
    const { stripe } = stripeWithRefunds();
    const { mailer: m, sent } = mailer();

    await adminCancelOne('legacy-9', { reason: 'Closed for weather', notifyCustomer: true, cause: 'blackout' }, { db, stripe, mailer: m });

    assert.equal(sent.length, 1);
    assert.match(sent[0]!.text, /Capt\. Travis will refund your \$90 himself/);
    assert.doesNotMatch(sent[0]!.text, /has been issued/);
  });

  test('closes an open checkout at Stripe before cancelling an unpaid booking', async () => {
    const { db, store } = fakeDb({
      b2: { ...base, id: 'b2', status: 'pending-payment', paymentStatus: 'pending', amountPaidCents: 0, stripeCheckoutSessionId: 'cs_2' },
    });
    const { stripe, calls, refunds } = stripeWithRefunds('open');
    const { mailer: m, sent } = mailer();

    const r = await adminCancelOne('b2', { reason: null, cause: 'admin' }, { db, stripe, mailer: m });

    assert.deepEqual(calls, ['expire cs_2']);
    assert.equal(refunds.length, 0);
    assert.equal(r.kind, 'cancelled');
    assert.equal(store.get('b2')!.status, 'cancelled');
    assert.match(sent[0]!.text, /You weren't charged for this booking/);
    assert.doesNotMatch(sent[0]!.text, /Per our policy/);
  });

  test('an unfinished checkout it cancels is marked failed, as one Stripe expired is, so Reports leave it out', async () => {
    // Travis cancelling it, or a closure that cancels or offers a new date.
    const { db, store } = fakeDb({
      b2: { ...base, id: 'b2', status: 'pending-payment', paymentStatus: 'pending', amountPaidCents: 0, stripeCheckoutSessionId: 'cs_2' },
      'legacy-9': { ...base, id: 'legacy-9', status: 'pending-payment', paymentStatus: 'pending', amountPaidCents: 0, legacy: { bookingId: 9 } },
    });
    const { stripe } = stripeWithRefunds('open');
    const { mailer: m } = mailer();

    await adminCancelOne('b2', { reason: 'Closed for weather', notifyCustomer: true, cause: 'blackout', closureId: 'bo1' }, { db, stripe, mailer: m });
    await adminCancelOne('legacy-9', { reason: null, cause: 'admin' }, { db, stripe, mailer: m });

    assert.equal(store.get('b2')!.status, 'cancelled');
    assert.equal(store.get('b2')!.paymentStatus, 'failed');
    // An old-site reservation was a real booking, paid or not: still counted as one.
    assert.equal(store.get('legacy-9')!.status, 'cancelled');
    assert.equal(store.get('legacy-9')!.paymentStatus, 'pending');
  });

  test('if a payment lands on that checkout after all, it’s refunded and recorded over the mark', async () => {
    const { db, store } = fakeDb({
      b2: { ...base, id: 'b2', status: 'pending-payment', paymentStatus: 'pending', amountPaidCents: 0, stripeCheckoutSessionId: 'cs_2' },
    });
    const { stripe } = stripeWithRefunds('open');
    const { mailer: m } = mailer();
    await adminCancelOne('b2', { reason: null, cause: 'admin' }, { db, stripe, mailer: m });

    const alerts: string[] = [];
    const outcome = await recordCompletedCheckout(
      {
        id: 'cs_2',
        metadata: { bookingId: 'b2' },
        payment_status: 'paid',
        amount_total: 26000,
        payment_intent: 'pi_late',
        livemode: false,
      } as Stripe.Checkout.Session,
      {
        db,
        stripe: { refunds: { create: async () => ({ id: 're_late', amount: 26000 }) } } as unknown as Pick<Stripe, 'refunds'>,
        sendConfirmation: async () => assert.fail('no confirmation for a cancelled booking'),
        alertAdmin: async (a) => void alerts.push(a.outcome),
      },
    );

    assert.equal(outcome, 'refunded');
    assert.deepEqual(alerts, ['refunded']);
    const after = store.get('b2')!;
    assert.equal(after.status, 'cancelled');
    // Counted again (Taken and refunded alike), as for a checkout Stripe expired.
    assert.equal(after.paymentStatus, 'refunded');
    assert.equal(after.amountPaidCents, 26000);
    assert.equal(after.amountRefundedCents, 26000);
  });

  test('leaves the booking alone if the customer paid as Travis cancelled', async () => {
    const { db, store } = fakeDb({
      b3: { ...base, id: 'b3', status: 'pending-payment', paymentStatus: 'pending', amountPaidCents: 0, stripeCheckoutSessionId: 'cs_3' },
    });
    const { stripe } = stripeWithRefunds('complete');
    const { mailer: m, sent } = mailer();

    const r = await adminCancelOne('b3', { reason: null, cause: 'admin' }, { db, stripe, mailer: m });

    assert.equal(r.kind, 'paid-meanwhile');
    assert.equal(store.get('b3')!.status, 'pending-payment');
    assert.equal(sent.length, 0);
  });

  test('won’t cancel a tour that already happened', async () => {
    const { db, store } = fakeDb({
      b4: { ...base, id: 'b4', status: 'completed', paymentStatus: 'paid', amountPaidCents: 13000, stripePaymentIntentId: 'pi_4' },
    });
    const { stripe, refunds } = stripeWithRefunds();
    const { mailer: m } = mailer();

    const r = await adminCancelOne('b4', { reason: null, cause: 'admin' }, { db, stripe, mailer: m });

    assert.deepEqual(r, { kind: 'not-active', status: 'completed' });
    assert.equal(refunds.length, 0);
    assert.equal(store.get('b4')!.status, 'completed');
  });

  test('a booking that was partly refunded before is marked refunded once the rest goes back', async () => {
    const { db, store } = fakeDb({
      b5: { ...base, id: 'b5', status: 'confirmed', paymentStatus: 'partial-refund', amountPaidCents: 20000, amountRefundedCents: 5000, stripePaymentIntentId: 'pi_5' },
    });
    const { stripe, refunds } = stripeWithRefunds('open', { paymentIntent: 'pi_5', earlier: [{ amount: 5000 }] });
    const { mailer: m } = mailer();

    await adminCancelOne('b5', { reason: null, cause: 'admin' }, { db, stripe, mailer: m });

    assert.equal(refunds[0]!.amount, 15000);
    assert.equal(store.get('b5')!.paymentStatus, 'refunded');
    assert.equal(store.get('b5')!.amountRefundedCents, 20000);
  });

  test('Stripe’s webhook landing first doesn’t make the refund count twice', async () => {
    const { db, store } = fakeDb(
      {
        b6: { ...base, id: 'b6', status: 'confirmed', paymentStatus: 'partial-refund', amountPaidCents: 20000, amountRefundedCents: 5000, stripePaymentIntentId: 'pi_6' },
      },
      {
        // charge.refunded reports the payment's whole refunded total.
        beforeCommit: (s, attempt) => {
          if (attempt === 1) s.set('b6', { ...s.get('b6'), amountRefundedCents: 20000, paymentStatus: 'refunded' });
        },
      },
    );
    const { stripe, refunds } = stripeWithRefunds('open', { paymentIntent: 'pi_6', earlier: [{ amount: 5000 }] });
    const { mailer: m } = mailer();

    await adminCancelOne('b6', { reason: 'Weather', cause: 'blackout' }, { db, stripe, mailer: m });

    assert.deepEqual(refunds, [{ amount: 15000, key: 'blackout-cancel-b6' }]);
    const after = store.get('b6')!;
    assert.equal(after.status, 'cancelled');
    assert.equal(after.amountRefundedCents, 20000);
    assert.equal(after.paymentStatus, 'refunded');
  });
});

/**
 * Closing a day, the closure deadline and the customer's "refund me
 * instead" read the booking, then cancel it: Travis or the customer can
 * move it, or someone else cancel it, in between.
 */
describe('adminCancelOne, when the booking changes meanwhile', () => {
  const paid: Doc = { ...base, id: 'b1', status: 'confirmed', paymentStatus: 'paid', amountPaidCents: 26000, stripePaymentIntentId: 'pi_1' };
  const onTrip = { date: '2099-07-04', timeSlot: 'morning' };

  test('moved off the trip the caller found it on: left alone, before anything goes to Stripe', async () => {
    const { db, store } = fakeDb({
      moved: { ...paid, id: 'moved', date: '2099-07-11' },
      later: { ...paid, id: 'later', timeSlot: 'late-afternoon' },
      reopened: { ...paid, id: 'reopened' },
      reclosed: { ...paid, id: 'reclosed', closure: { blackoutId: 'bo2', reason: 'Closed for weather', decideBy: '2099-07-07' } },
    });
    const { stripe, refunds } = stripeWithRefunds();
    const { mailer: m, sent } = mailer();

    for (const [id, expect] of [
      ['moved', onTrip],
      ['later', onTrip],
      // Waiting on closure bo1 when the caller looked; not any more.
      ['reopened', { ...onTrip, closureBlackoutId: 'bo1' }],
      ['reclosed', { ...onTrip, closureBlackoutId: 'bo1' }],
    ] as const) {
      const r = await adminCancelOne(id, { reason: 'Closed for weather', cause: 'blackout', expect }, { db, stripe, mailer: m });
      assert.deepEqual(r, { kind: 'changed' }, id);
      assert.equal(store.get(id)!.status, 'confirmed', id);
    }
    assert.equal(refunds.length, 0);
    assert.equal(sent.length, 0);
  });

  test('still where the caller found it: cancelled as usual', async () => {
    const closure = { blackoutId: 'bo1', reason: 'Closed for weather', decideBy: '2099-07-07' };
    const { db, store } = fakeDb({ b1: { ...paid, closure } });
    const { stripe, refunds } = stripeWithRefunds();
    const { mailer: m } = mailer();

    const r = await adminCancelOne('b1', { reason: 'Closed for weather', cause: 'blackout', expect: { ...onTrip, closureBlackoutId: 'bo1' } }, { db, stripe, mailer: m });

    assert.equal(r.kind, 'cancelled');
    assert.equal(refunds.length, 1);
    assert.equal(store.get('b1')!.status, 'cancelled');
  });

  test('moved as Stripe took the refund: not cancelled, and the refund is kept on the booking and reported', async () => {
    const { db, store } = fakeDb(
      { b1: { ...paid, adminNotes: 'Anniversary' } },
      {
        // Travis reschedules it while the refund is going through.
        beforeCommit: (s, attempt) => {
          if (attempt === 1) s.set('b1', { ...s.get('b1'), date: '2099-07-11' });
        },
      },
    );
    const { stripe, refunds } = stripeWithRefunds();
    const { mailer: m, sent } = mailer();

    const r = await adminCancelOne('b1', { reason: 'Closed for weather', cause: 'blackout', expect: onTrip }, { db, stripe, mailer: m });

    assert.deepEqual(r, { kind: 'changed', refundCents: 26000, stripeRefundId: 're_1' });
    assert.equal(refunds.length, 1);
    const after = store.get('b1')!;
    assert.equal(after.status, 'confirmed');
    assert.equal(after.date, '2099-07-11');
    assert.equal(after.amountRefundedCents, 26000);
    assert.equal(after.paymentStatus, 'refunded');
    assert.match(String(after.adminNotes), /^Anniversary\n.*\$260 was refunded to cancel it, but it was moved or put back on its trip at the same moment, so it’s still booked\./);
    assert.equal(sent.length, 0);
  });

  test('cancelled another way as Stripe took the refund: left as it was, and the refund is kept and reported', async () => {
    const { db, store } = fakeDb(
      { b1: paid },
      {
        // The customer's own cancel, inside 72 hours: no refund from them.
        beforeCommit: (s, attempt) => {
          if (attempt === 1) s.set('b1', { ...s.get('b1'), status: 'cancelled', cancelledBy: 'customer' });
        },
      },
    );
    const { stripe } = stripeWithRefunds();
    const { mailer: m, sent } = mailer();

    const r = await adminCancelOne('b1', { reason: null, cause: 'admin' }, { db, stripe, mailer: m });

    assert.deepEqual(r, { kind: 'already-cancelled', refundCents: 26000, stripeRefundId: 're_1' });
    const after = store.get('b1')!;
    assert.equal(after.cancelledBy, 'customer');
    assert.equal(after.amountRefundedCents, 26000);
    assert.equal(after.paymentStatus, 'refunded');
    assert.match(String(after.adminNotes), /Cancelled another way just as \$260 was refunded to cancel it here\. The refund stands\./);
    assert.equal(sent.length, 0);
  });

  test('already cancelled before it looked: nothing to report', async () => {
    const { db } = fakeDb({ b1: { ...paid, status: 'cancelled' } });
    const { stripe, refunds } = stripeWithRefunds();
    const { mailer: m } = mailer();
    assert.deepEqual(await adminCancelOne('b1', { reason: null, cause: 'admin' }, { db, stripe, mailer: m }), { kind: 'already-cancelled' });
    assert.equal(refunds.length, 0);
  });
});

describe('adminCancelOne, the email', () => {
  test('names the trip by its date, and says why when a closed booking ends', async () => {
    const paid: Doc = { ...base, tourName: '2hr Morning Tour — Shared', status: 'confirmed', paymentStatus: 'paid', amountPaidCents: 26000, stripePaymentIntentId: 'pi_1' };
    const { db } = fakeDb({ a: { ...paid, id: 'a' }, b: { ...paid, id: 'b' } });
    const { stripe } = stripeWithRefunds();
    const { mailer: m, sent } = mailer();

    await adminCancelOne('a', { reason: 'Boat trouble', cause: 'admin' }, { db, stripe, mailer: m });
    await adminCancelOne('b', { reason: 'Closed for weather', cause: 'blackout', emailCause: 'refund-chosen' }, { db, stripe, mailer: m });

    // Travis cancelling one booking, often because they asked him to: no
    // "had to cancel… usually weather", just that it's cancelled and why.
    assert.equal(sent[0]!.subject, 'Your booking for the Saturday, Jul 4 tour has been cancelled');
    assert.match(sent[0]!.text, /Your booking for the tour on Saturday, July 4, 2099 has been cancelled\.\n\nReason: Boat trouble\n/);
    assert.doesNotMatch(sent[0]!.text, /Sorry to break the news|had to cancel|weather/);
    assert.equal(sent[1]!.subject, 'Your Saturday, Jul 4 tour is cancelled, as you asked');
    assert.match(sent[1]!.text, /As you asked, your tour on Saturday, July 4, 2099 is cancelled rather than moved to another date/);
    assert.doesNotMatch(sent[1]!.text, /Sorry to break the news/);
    assert.match(sent[1]!.text, /full refund of \$260 has been issued/);
  });
});

/**
 * Stripe turned the booking's refund down (a disputed payment, say): the
 * money goes back through the dispute, or Travis refunds it in Stripe's
 * dashboard, and he cancels it here without a refund.
 */
describe('adminCancelOne, a refund handled in Stripe', () => {
  const paid: Doc = { ...base, id: 'b1', status: 'confirmed', paymentStatus: 'paid', amountPaidCents: 26000, stripePaymentIntentId: 'pi_1' };
  const refusedAtDeadline = {
    blackoutId: 'bo1',
    reason: 'Closed for weather',
    decideBy: '2099-06-30',
    refundRefused: { at: 1, refundCents: 26000, stripeMessage: 'Charge ch_1 has been disputed.' },
  };
  const handled = { reason: null, cause: 'admin', refundHandledInStripe: true } as const;

  test('a deadline refund Stripe turned down: cancelled with no refund from here, the money recorded as given back by hand', async () => {
    const { db, store } = fakeDb({ b1: { ...paid, adminNotes: 'Anniversary', closure: refusedAtDeadline } });
    const { stripe, refunds } = stripeWithRefunds();
    const { mailer: m, sent } = mailer();

    const r = await adminCancelOne('b1', handled, { db, stripe, mailer: m });

    assert.equal(r.kind, 'cancelled');
    if (r.kind !== 'cancelled') return;
    assert.deepEqual([r.refundCents, r.manualRefundCents, r.handledInStripeCents, r.emailed], [0, 0, 26000, false]);
    assert.equal(refunds.length, 0, 'nothing went to Stripe');
    assert.equal(sent.length, 0, 'not emailed unless Travis asks');
    const after = store.get('b1')!;
    assert.equal(after.status, 'cancelled');
    assert.equal(after.cancelledBy, 'admin');
    assert.equal(after.amountRefundedCents, 0);
    // So Reports count it as given back, and nothing is left owing.
    assert.equal(after.manualRefundCents, 26000);
    assert.ok(after.manualRefundedAt);
    assert.match(String(after.adminNotes), /^Anniversary\n.*Cancelled with the refund handled in Stripe \(a dispute or a refund there\): Stripe had turned the refund down, so none went from here\. \$260 recorded as refunded by hand\.$/);
  });

  test('only what Stripe hasn’t recorded as refunded, and the email (if asked for) says it’s been refunded', async () => {
    // Travis refunded $100 in Stripe's dashboard; its webhook recorded it.
    const { db, store } = fakeDb({
      b1: { ...paid, amountRefundedCents: 10000, paymentStatus: 'partial-refund', cancelRefundRefused: { at: 1, refundCents: 26000, stripeMessage: 'Charge ch_1 has been disputed.' } },
    });
    const { stripe, refunds } = stripeWithRefunds();
    const { mailer: m, sent } = mailer();

    const r = await adminCancelOne('b1', { ...handled, notifyCustomer: true }, { db, stripe, mailer: m });

    assert.equal(r.kind === 'cancelled' && r.handledInStripeCents, 16000);
    assert.equal(refunds.length, 0);
    assert.equal(store.get('b1')!.manualRefundCents, 16000);
    assert.equal(store.get('b1')!.amountRefundedCents, 10000);
    assert.match(sent[0]!.text, /Your payment has already been refunded\./);
    assert.doesNotMatch(sent[0]!.text, /will refund|has been issued/);
  });

  test('not for a booking whose refund Stripe hasn’t turned down: Cancel refunds those', async () => {
    const { db, store } = fakeDb({
      b1: paid,
      // Offered a new date, deadline not reached: nothing refused yet.
      b2: { ...paid, id: 'b2', closure: { blackoutId: 'bo1', reason: 'Closed for weather', decideBy: '2099-07-07' } },
    });
    const { stripe, refunds } = stripeWithRefunds();
    const { mailer: m } = mailer();

    for (const id of ['b1', 'b2']) {
      assert.deepEqual(await adminCancelOne(id, handled, { db, stripe, mailer: m }), { kind: 'no-refused-refund' }, id);
      assert.equal(store.get(id)!.status, 'confirmed', id);
    }
    assert.equal(refunds.length, 0);
  });

  test('moved meanwhile, its closure and refusal gone with it: left alone', async () => {
    const { db, store } = fakeDb(
      { b1: { ...paid, closure: refusedAtDeadline } },
      {
        beforeCommit: (s, attempt) => {
          if (attempt === 1) {
            const moved = { ...s.get('b1')!, date: '2099-07-11' };
            delete moved.closure;
            s.set('b1', moved);
          }
        },
      },
    );
    const { stripe } = stripeWithRefunds();
    const { mailer: m } = mailer();

    assert.deepEqual(await adminCancelOne('b1', handled, { db, stripe, mailer: m }), { kind: 'changed' });
    assert.equal(store.get('b1')!.status, 'confirmed');
    assert.equal(store.get('b1')!.manualRefundCents, undefined);
  });

  test('Travis’s own Cancel turned down by Stripe is kept, so the booking offers it from then on', async () => {
    const { db, store } = fakeDb({
      b1: { ...paid, amountRefundedCents: 6000 },
      gone: { ...paid, id: 'gone', status: 'cancelled', cancelledBy: 'customer' },
    });

    assert.equal(await keepRefusedCancelRefund('b1', 'Charge ch_1 has been disputed.', { db }), 'kept');
    const kept = store.get('b1')!.cancelRefundRefused as { at: unknown; refundCents: number; stripeMessage: string };
    assert.ok(kept.at);
    assert.deepEqual([kept.refundCents, kept.stripeMessage], [20000, 'Charge ch_1 has been disputed.']);
    // The customer's own refund got there first: that's why Stripe said no.
    assert.equal(await keepRefusedCancelRefund('gone', 'Charge ch_1 has already been refunded.', { db }), 'already-cancelled');
    assert.equal(store.get('gone')!.cancelRefundRefused, undefined);
    assert.equal(await keepRefusedCancelRefund('nope', 'x', { db }), 'not-found');
  });

  test('a refusal is Stripe saying no, not its 409 or an outage', () => {
    const stripeError = (type: string, extra: Record<string, unknown> = {}) => Object.assign(new Error('no'), { type, ...extra });
    assert.equal(stripeRefusedRefund(stripeError('StripeInvalidRequestError')), true);
    assert.equal(stripeRefusedRefund(stripeError('StripeCardError')), true);
    assert.equal(stripeRefusedRefund(stripeError('StripeInvalidRequestError', { statusCode: 409 })), false);
    assert.equal(stripeRefusedRefund(stripeError('StripeIdempotencyError', { code: 'idempotency_key_in_use' })), false);
    assert.equal(stripeRefusedRefund(stripeError('StripeConnectionError')), false);
    assert.equal(stripeRefusedRefund({ type: 'StripeInvalidRequestError' }), false);
  });
});

describe('adminCancelOne, an address Resend won’t send to', () => {
  test('flagged on the booking as a permanent bounce, for Travis to check the address, and reported as such', async () => {
    const { db, store } = fakeDb({
      b1: { ...base, id: 'b1', customerEmail: 'pat@example', status: 'confirmed', paymentStatus: 'paid', amountPaidCents: 26000, stripePaymentIntentId: 'pi_1' },
      b2: { ...base, id: 'b2', status: 'confirmed', paymentStatus: 'paid', amountPaidCents: 26000, stripePaymentIntentId: 'pi_1' },
    });
    const { stripe } = stripeWithRefunds();
    const m: CancellationMailer = {
      marina: { name: 'Marina', address: '1 Dock St' },
      phoneDisplay: '352-586-7792',
      async send({ to }) {
        if (to === 'pat@example') throw new EmailSendError('validation_error', 'Invalid `to` field.');
        throw new EmailSendError('application_error', 'Resend is down');
      },
    };

    const refused = await adminCancelOne('b1', { reason: null, cause: 'admin' }, { db, stripe, mailer: m });
    const down = await adminCancelOne('b2', { reason: null, cause: 'admin' }, { db, stripe, mailer: m });

    assert.equal(refused.kind === 'cancelled' && refused.emailRejected, true);
    assert.equal(refused.kind === 'cancelled' && refused.emailFailed, true);
    const bounce = (store.get('b1')!.emailBounces as Record<string, Record<string, unknown>>).cancellation!;
    assert.equal(bounce.to, 'pat@example');
    assert.equal(bounce.bounceType, 'Permanent');
    assert.equal(bounce.bounceMessage, 'Resend failed: Invalid `to` field.');
    assert.equal(bounce.emailId, 'refused/cancellation/b1');
    assert.match(String(bounce.subject), /has been cancelled/);
    // Resend being down is worth trying again: nothing flagged.
    assert.equal(down.kind === 'cancelled' && down.emailRejected, false);
    assert.equal(store.get('b2')!.emailBounces, undefined);
  });
});

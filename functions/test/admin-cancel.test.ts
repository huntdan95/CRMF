/**
 * Travis cancelling a booking (from the booking page or by closing a day),
 * against in-memory stand-ins for Firestore, Stripe and email.
 * Run with `npm test` in functions/.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type Stripe from 'stripe';

import { adminCancelOne, type CancellationMailer } from '../src/lib/admin-cancel';
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

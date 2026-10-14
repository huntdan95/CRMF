/**
 * A customer cancelling a booking they haven't paid for, against in-memory
 * stand-ins for Firestore and Stripe. Run with `npm test` in functions/.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { cancelUnpaidBooking } from '../src/cancelBooking';
import { TOKEN, fakeDb, fakeStripe, type Doc } from './fakes';

const hold = { bookingId: 'b1', accessToken: TOKEN };

const pending: Doc = {
  id: 'b1',
  status: 'pending-payment',
  paymentStatus: 'pending',
  amountPaidCents: 0,
  amountRefundedCents: 0,
  accessToken: TOKEN,
  stripeCheckoutSessionId: 'cs_1',
};

describe('cancelUnpaidBooking', () => {
  test('expires the Stripe session before cancelling, so it can’t be paid later', async () => {
    const { db, store } = fakeDb({ b1: pending });
    const { stripe, calls } = fakeStripe('open');
    const result = await cancelUnpaidBooking(hold, 'Plans changed', { db, stripe });
    assert.equal(result.outcome, 'released');
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, {
      ok: true,
      unpaid: true,
      refundCents: 0,
      refundPercent: 0,
      stripeRefundId: null,
    });
    assert.deepEqual(calls, ['expire cs_1']);
    const b = store.get('b1')!;
    assert.equal(b.status, 'cancelled');
    assert.equal(b.cancelledBy, 'customer');
    assert.equal(b.cancellationReason, 'Plans changed');
  });

  test('records why when the customer gives no reason', async () => {
    const { db, store } = fakeDb({ b1: pending });
    const { stripe } = fakeStripe('open');
    await cancelUnpaidBooking(hold, undefined, { db, stripe });
    assert.equal(store.get('b1')!.cancellationReason, 'Cancelled before paying');
  });

  test('cancels when Stripe already expired the session', async () => {
    const { db, store } = fakeDb({ b1: pending });
    const { stripe } = fakeStripe('expired');
    const result = await cancelUnpaidBooking(hold, undefined, { db, stripe });
    assert.equal(result.status, 200);
    assert.equal(store.get('b1')!.status, 'cancelled');
  });

  test('refuses once the customer has paid, even before the webhook confirms it', async () => {
    const { db, store } = fakeDb({ b1: pending });
    const { stripe } = fakeStripe('complete');
    const result = await cancelUnpaidBooking(hold, undefined, { db, stripe });
    assert.equal(result.outcome, 'checkout-complete');
    assert.equal(result.status, 409);
    assert.match(String(result.body.error), /payment just went through/);
    assert.equal(store.get('b1')!.status, 'pending-payment');
  });

  test('refuses if the webhook confirmed the booking first', async () => {
    const { db, store } = fakeDb({ b1: { ...pending, status: 'confirmed', paymentStatus: 'paid' } });
    const { stripe, calls } = fakeStripe('complete');
    const result = await cancelUnpaidBooking(hold, undefined, { db, stripe });
    assert.equal(result.outcome, 'not-held');
    assert.equal(result.status, 409);
    assert.deepEqual(calls, []);
    assert.equal(store.get('b1')!.status, 'confirmed');
  });

  test('reports it already cancelled if the expiry webhook got there first', async () => {
    const { db, store } = fakeDb({ b1: pending });
    const { stripe } = fakeStripe('open', {
      onExpire: () =>
        store.set('b1', { ...pending, status: 'cancelled', cancellationReason: 'Checkout session expired' }),
    });
    const result = await cancelUnpaidBooking(hold, undefined, { db, stripe });
    assert.equal(result.status, 200);
    assert.equal(result.body.alreadyCancelled, true);
    assert.equal(store.get('b1')!.cancellationReason, 'Checkout session expired');
  });

  test('changes nothing when Stripe is down', async () => {
    const { db, store } = fakeDb({ b1: pending });
    const { stripe } = fakeStripe('open', { outage: true });
    await assert.rejects(cancelUnpaidBooking(hold, undefined, { db, stripe }), /Stripe is down/);
    assert.equal(store.get('b1')!.status, 'pending-payment');
  });

  test('asks them to retry while the Stripe session is still being created', async () => {
    const { db, store } = fakeDb({ b1: { ...pending, stripeCheckoutSessionId: undefined } });
    const { stripe, calls } = fakeStripe('open');
    const result = await cancelUnpaidBooking(hold, undefined, { db, stripe });
    assert.equal(result.status, 409);
    assert.deepEqual(calls, []);
    assert.equal(store.get('b1')!.status, 'pending-payment');
  });
});

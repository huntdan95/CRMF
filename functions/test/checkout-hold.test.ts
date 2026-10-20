/**
 * Releasing an abandoned checkout's hold, against in-memory stand-ins for
 * Firestore and Stripe. Run with `npm test` in functions/.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { releaseHold } from '../src/lib/checkout-hold';
import { TOKEN, fakeDb, fakeStripe, type Doc } from './fakes';

const hold = { bookingId: 'b1', accessToken: TOKEN };

const pending: Doc = {
  id: 'b1',
  status: 'pending-payment',
  paymentStatus: 'pending',
  accessToken: TOKEN,
  stripeCheckoutSessionId: 'cs_1',
};

describe('releaseHold', () => {
  test('expires the open Stripe session, then cancels the booking', async () => {
    const { db, store } = fakeDb({ b1: pending });
    const { stripe, calls } = fakeStripe('open');
    assert.equal(await releaseHold(hold, { db, stripe }), 'released');
    assert.deepEqual(calls, ['expire cs_1']);
    const b = store.get('b1')!;
    assert.equal(b.status, 'cancelled');
    assert.equal(b.paymentStatus, 'failed');
    assert.equal(b.cancelledBy, 'customer');
  });

  test('a released checkout no longer keeps its visitor’s hash: only unpaid ones are counted', async () => {
    const { db, store } = fakeDb({ b1: { ...pending, checkoutIpHash: 'hash-1' } });
    const { stripe } = fakeStripe('open');
    assert.equal(await releaseHold(hold, { db, stripe }), 'released');
    assert.equal('checkoutIpHash' in store.get('b1')!, false);
  });

  test('leaves a paid checkout alone, even before the webhook confirms it', async () => {
    const { db, store } = fakeDb({ b1: pending });
    const { stripe, calls } = fakeStripe('complete');
    assert.equal(await releaseHold(hold, { db, stripe }), 'checkout-complete');
    assert.deepEqual(calls, ['expire cs_1', 'retrieve cs_1']);
    assert.equal(store.get('b1')!.status, 'pending-payment');
  });

  test('cancels the booking when Stripe already expired the session', async () => {
    const { db, store } = fakeDb({ b1: pending });
    const { stripe } = fakeStripe('expired');
    assert.equal(await releaseHold(hold, { db, stripe }), 'released');
    assert.equal(store.get('b1')!.status, 'cancelled');
  });

  test('changes nothing when Stripe fails to expire an open session', async () => {
    const { db, store } = fakeDb({ b1: pending });
    const { stripe } = fakeStripe('open', { outage: true });
    await assert.rejects(releaseHold(hold, { db, stripe }), /Stripe is down/);
    assert.equal(store.get('b1')!.status, 'pending-payment');
  });

  test('needs the booking’s access token', async () => {
    const { db, store } = fakeDb({ b1: pending });
    const { stripe, calls } = fakeStripe('open');
    const outcome = await releaseHold({ bookingId: 'b1', accessToken: 'not-the-token' }, { db, stripe });
    assert.equal(outcome, 'not-found');
    assert.deepEqual(calls, []);
    assert.equal(store.get('b1')!.status, 'pending-payment');
  });

  test('reports a booking that does not exist', async () => {
    const { db } = fakeDb({});
    const { stripe, calls } = fakeStripe('open');
    assert.equal(await releaseHold(hold, { db, stripe }), 'not-found');
    assert.deepEqual(calls, []);
  });

  test('only touches pending-payment bookings', async () => {
    for (const status of ['confirmed', 'cancelled', 'completed'] as const) {
      const { db, store } = fakeDb({ b1: { ...pending, status } });
      const { stripe, calls } = fakeStripe('open');
      assert.equal(await releaseHold(hold, { db, stripe }), 'not-held', status);
      assert.deepEqual(calls, []);
      assert.equal(store.get('b1')!.status, status);
    }
  });

  test('waits for a booking whose Stripe session is still being created', async () => {
    const { db, store } = fakeDb({ b1: { ...pending, stripeCheckoutSessionId: undefined } });
    const { stripe, calls } = fakeStripe('open');
    assert.equal(await releaseHold(hold, { db, stripe }), 'no-session');
    assert.deepEqual(calls, []);
    assert.equal(store.get('b1')!.status, 'pending-payment');
  });

  test('does not overwrite a change made while Stripe was being called', async () => {
    const { db, store } = fakeDb({ b1: pending });
    // The checkout.session.expired webhook lands first.
    const { stripe } = fakeStripe('open', {
      onExpire: () =>
        store.set('b1', { ...pending, status: 'cancelled', cancellationReason: 'Checkout session expired' }),
    });
    assert.equal(await releaseHold(hold, { db, stripe }), 'not-held');
    assert.equal(store.get('b1')!.cancellationReason, 'Checkout session expired');
  });
});

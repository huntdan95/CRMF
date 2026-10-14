/**
 * Releasing an abandoned checkout's hold, against in-memory stand-ins for
 * Firestore and Stripe. Run with `npm test` in functions/.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Firestore } from 'firebase-admin/firestore';
import type Stripe from 'stripe';

import { releaseHold } from '../src/lib/checkout-hold';
import type { Booking } from '../src/lib/types';

const TOKEN = '6f1c7a52-0000-4000-8000-000000000000';
const hold = { bookingId: 'b1', accessToken: TOKEN };

type Doc = Partial<Booking> & Record<string, unknown>;

/** Just enough of Firestore for releaseHold: doc get + a transaction. */
function fakeDb(docs: Record<string, Doc>) {
  const store = new Map(Object.entries(docs));
  const ref = (id: string) => ({
    id,
    get: async () => ({ exists: store.has(id), data: () => (store.has(id) ? { ...store.get(id) } : undefined) }),
  });
  const db = {
    collection: (name: string) => {
      assert.equal(name, 'bookings');
      return { doc: ref };
    },
    runTransaction: async <T>(fn: (tx: unknown) => Promise<T>) =>
      fn({
        get: (r: ReturnType<typeof ref>) => r.get(),
        update: (r: ReturnType<typeof ref>, data: Doc) => store.set(r.id, { ...store.get(r.id), ...data }),
      }),
  };
  return { db: db as unknown as Firestore, store };
}

/** A Checkout session that only `expire`s while open, like Stripe's. */
function fakeStripe(
  status: Stripe.Checkout.Session['status'],
  opts: { outage?: boolean; onExpire?: () => void } = {},
) {
  const calls: string[] = [];
  let current = status;
  const stripe = {
    checkout: {
      sessions: {
        expire: async (id: string) => {
          calls.push(`expire ${id}`);
          if (opts.outage) throw new Error('Stripe is down');
          if (current !== 'open') throw new Error(`Session is ${current}`);
          current = 'expired';
          opts.onExpire?.();
          return { id, status: current };
        },
        retrieve: async (id: string) => {
          calls.push(`retrieve ${id}`);
          return { id, status: current };
        },
      },
    },
  };
  return { stripe: stripe as unknown as Pick<Stripe, 'checkout'>, calls };
}

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

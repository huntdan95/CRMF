/**
 * In-memory stand-ins for Firestore and Stripe, shared by the tests.
 */
import assert from 'node:assert/strict';
import type { Firestore } from 'firebase-admin/firestore';
import type Stripe from 'stripe';

import type { Booking } from '../src/lib/types';

export const TOKEN = '6f1c7a52-0000-4000-8000-000000000000';

export type Doc = Partial<Booking> & Record<string, unknown>;

/** Just enough of Firestore for bookings: doc get + a transaction. */
export function fakeDb(docs: Record<string, Doc>) {
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
export function fakeStripe(
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

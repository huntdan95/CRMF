/**
 * In-memory stand-ins for Firestore and Stripe, shared by the tests.
 */
import assert from 'node:assert/strict';
import type { Firestore } from 'firebase-admin/firestore';
import type Stripe from 'stripe';

import type { Booking } from '../src/lib/types';

export const TOKEN = '6f1c7a52-0000-4000-8000-000000000000';

export type Doc = Partial<Booking> & Record<string, unknown>;

/**
 * Just enough of Firestore for bookings: doc gets, `where(field, '==', x)`
 * queries, and transactions that act like Firestore's. Writes land when the
 * transaction commits, and if anything it read changed before then, it runs
 * again. `beforeCommit` changes the store at that moment, as a request
 * landing in between would. `commits` lists what each committed transaction
 * read and wrote.
 */
export function fakeDb(
  docs: Record<string, Doc>,
  opts: { beforeCommit?: (store: Map<string, Doc>, attempt: number) => void } = {},
) {
  const store = new Map(Object.entries(docs));
  const commits: Array<{ reads: string[]; writes: string[] }> = [];
  const ref = (id: string) => ({
    id,
    path: `bookings/${id}`,
    peek: () => store.get(id) ?? null,
    get: async () => ({ exists: store.has(id), data: () => (store.has(id) ? { ...store.get(id) } : undefined) }),
  });
  const query = (field: string, value: unknown) => {
    const matches = () => [...store.entries()].filter(([, d]) => d[field] === value);
    return {
      path: `bookings where ${field} == ${String(value)}`,
      peek: () => matches(),
      get: async () => ({ docs: matches().map(([id, d]) => ({ id, data: () => ({ ...d }) })) }),
    };
  };
  type Readable = ReturnType<typeof ref> | ReturnType<typeof query>;
  const db = {
    collection: (name: string) => {
      assert.equal(name, 'bookings');
      return {
        doc: ref,
        where: (field: string, op: string, value: unknown) => {
          assert.equal(op, '==');
          return query(field, value);
        },
      };
    },
    runTransaction: async <T>(fn: (tx: unknown) => Promise<T>) => {
      for (let attempt = 1; attempt <= 5; attempt++) {
        const reads: Array<{ r: Readable; seen: string }> = [];
        const writes: Array<{ id: string; data: Doc }> = [];
        const result = await fn({
          get: (r: Readable) => {
            assert.equal(writes.length, 0, 'a Firestore transaction reads before it writes');
            reads.push({ r, seen: JSON.stringify(r.peek()) });
            return r.get();
          },
          update: (r: ReturnType<typeof ref>, data: Doc) => {
            writes.push({ id: r.id, data });
          },
        });
        opts.beforeCommit?.(store, attempt);
        if (reads.some(({ r, seen }) => JSON.stringify(r.peek()) !== seen)) continue;
        for (const { id, data } of writes) store.set(id, { ...store.get(id), ...data });
        commits.push({ reads: reads.map(({ r }) => r.path), writes: writes.map(({ id }) => `bookings/${id}`) });
        return result;
      }
      throw new Error('Transaction kept conflicting');
    },
  };
  return { db: db as unknown as Firestore, store, commits };
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

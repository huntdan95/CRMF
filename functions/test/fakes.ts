/**
 * In-memory stand-ins for Firestore and Stripe, shared by the tests.
 */
import assert from 'node:assert/strict';
import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import type Stripe from 'stripe';

import type { Booking } from '../src/lib/types';

export const TOKEN = '6f1c7a52-0000-4000-8000-000000000000';

export type Doc = Partial<Booking> & Record<string, unknown>;

/**
 * Just enough of Firestore for bookings: doc gets and updates, `where`
 * queries (on dotted paths too), and transactions that act like
 * Firestore's. Writes land when the transaction commits, and if anything it
 * read changed before then, it runs again. `beforeCommit` changes the store
 * at that moment, as a request landing in between would. `commits` lists
 * what each committed transaction read and wrote. `blackouts` can be
 * queried by date; they never change.
 */
export function fakeDb(
  docs: Record<string, Doc>,
  opts: {
    beforeCommit?: (store: Map<string, Doc>, attempt: number) => void;
    blackouts?: Array<Record<string, unknown>>;
  } = {},
) {
  const store = new Map(Object.entries(docs));
  const commits: Array<{ reads: string[]; writes: string[] }> = [];
  /** Merges an update, dropping fields set to FieldValue.delete(). */
  const merge = (id: string, data: Doc) => {
    const next: Doc = { ...store.get(id) };
    for (const [k, v] of Object.entries(data)) {
      if (v instanceof FieldValue && v.isEqual(FieldValue.delete())) delete next[k];
      else next[k] = v;
    }
    store.set(id, next);
  };
  const ref = (id: string) => ({
    id,
    path: `bookings/${id}`,
    peek: () => store.get(id) ?? null,
    get: async () => ({ exists: store.has(id), data: () => (store.has(id) ? { ...store.get(id) } : undefined) }),
    update: async (data: Doc) => {
      assert.ok(store.has(id), `no booking ${id} to update`);
      merge(id, data);
    },
  });
  const field = (d: Record<string, unknown>, path: string): unknown =>
    path.split('.').reduce<unknown>((v, k) => (v && typeof v === 'object' ? (v as Record<string, unknown>)[k] : undefined), d);
  const compare: Record<string, (a: unknown, b: unknown) => boolean> = {
    '==': (a, b) => a === b,
    '<': (a, b) => a !== undefined && (a as string) < (b as string),
    '<=': (a, b) => a !== undefined && (a as string) <= (b as string),
    '>': (a, b) => a !== undefined && (a as string) > (b as string),
    '>=': (a, b) => a !== undefined && (a as string) >= (b as string),
  };
  const query = (path: string, op: string, value: unknown) => {
    assert.ok(compare[op], `unsupported where op ${op}`);
    const matches = () => [...store.entries()].filter(([, d]) => compare[op]!(field(d, path), value));
    return {
      path: `bookings where ${path} ${op} ${String(value)}`,
      peek: () => matches(),
      get: async () => ({ size: matches().length, docs: matches().map(([id, d]) => ({ id, data: () => ({ ...d }) })) }),
    };
  };
  const blackoutQuery = (path: string, op: string, value: unknown) => {
    assert.equal(op, '==');
    const matches = (opts.blackouts ?? []).filter((b) => field(b, path) === value);
    return {
      path: `blackouts where ${path} == ${String(value)}`,
      peek: () => matches,
      get: async () => ({ docs: matches.map((b, i) => ({ id: `bo${i}`, data: () => ({ ...b }) })) }),
    };
  };
  type Readable = ReturnType<typeof ref> | ReturnType<typeof query> | ReturnType<typeof blackoutQuery>;
  const db = {
    collection: (name: string) => {
      if (name === 'blackouts') return { where: blackoutQuery };
      assert.equal(name, 'bookings');
      return { doc: ref, where: query };
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
        for (const { id, data } of writes) merge(id, data);
        commits.push({ reads: reads.map(({ r }) => r.path), writes: writes.map(({ id }) => `bookings/${id}`) });
        return result;
      }
      throw new Error('Transaction kept conflicting');
    },
  };
  return { db: db as unknown as Firestore, store, commits };
}

/** A Firestore write that fails once, the first time a transaction commits. */
export function failFirstCommit() {
  let failed = false;
  return () => {
    if (failed) return;
    failed = true;
    throw new Error('Firestore unavailable');
  };
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

/**
 * Refunds against one payment, like Stripe's. A key used again returns the
 * saved response if the request is the same, and fails if it isn't, until
 * `forgetKeys()`: Stripe forgets keys after a day. Asked to, a refund comes
 * with its charge, whose `amount_refunded` is the payment's refunded total
 * at that moment. `list` finds refunds by payment intent, newest first.
 * `earlier` are refunds already on the payment; `created` lists the new ones.
 */
export function fakeRefunds(
  opts: { paymentIntent?: string; earlier?: Array<{ amount: number; metadata?: Record<string, string> }> } = {},
) {
  const paymentIntent = opts.paymentIntent ?? 'pi_1';
  type Refund = { id: string; amount: number; payment_intent: string; metadata: Record<string, string> };
  const refunds: Refund[] = (opts.earlier ?? []).map((r, i) => ({
    id: `re_earlier_${i + 1}`,
    amount: r.amount,
    payment_intent: paymentIntent,
    metadata: r.metadata ?? {},
  }));
  const created: Array<{ amount: number; key: string }> = [];
  const saved = new Map<string, { request: string; response: unknown }>();
  const refundedCents = () => refunds.reduce((sum, r) => sum + r.amount, 0);
  const withCharge = (r: Refund, expand: boolean) => ({
    ...r,
    charge: expand ? { id: 'ch_1', amount_refunded: refundedCents() } : 'ch_1',
  });
  const stripe = {
    refunds: {
      create: async (
        params: { payment_intent: string; amount: number; metadata?: Record<string, string>; expand?: string[] },
        o: { idempotencyKey: string },
      ) => {
        assert.equal(params.payment_intent, paymentIntent);
        const request = JSON.stringify(params);
        const earlier = saved.get(o.idempotencyKey);
        if (earlier) {
          if (earlier.request !== request) {
            throw Object.assign(new Error('Keys for idempotent requests can only be used with the same parameters'), {
              type: 'StripeIdempotencyError',
            });
          }
          return earlier.response;
        }
        const refund = {
          id: `re_${created.length + 1}`,
          amount: params.amount,
          payment_intent: paymentIntent,
          metadata: params.metadata ?? {},
        };
        refunds.push(refund);
        created.push({ amount: params.amount, key: o.idempotencyKey });
        const response = withCharge(refund, params.expand?.includes('charge') ?? false);
        saved.set(o.idempotencyKey, { request, response });
        return response;
      },
      list: async (params: { payment_intent: string; expand?: string[] }) => ({
        object: 'list',
        has_more: false,
        data: refunds
          .filter((r) => r.payment_intent === params.payment_intent)
          .reverse()
          .map((r) => withCharge(r, params.expand?.includes('data.charge') ?? false)),
      }),
    },
  };
  return {
    stripe: stripe as unknown as Pick<Stripe, 'refunds'>,
    created,
    /** The payment's refunded total, as charge.refunded reports it. */
    refundedCents,
    forgetKeys: () => saved.clear(),
  };
}

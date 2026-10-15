/**
 * In-memory stand-ins for Firestore and Stripe, shared by the tests.
 */
import assert from 'node:assert/strict';
import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import type Stripe from 'stripe';
import type { CreateEmailOptions, CreateEmailRequestOptions } from 'resend';

import type { Booking } from '../src/lib/types';
import type { EmailDeps } from '../src/lib/email-log';

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
 *
 * Other collections (`emailLog`, `resendWebhookEvents`…) work the same way
 * and live in `collections`. Updates take dotted field paths
 * (`'emailBounces.confirmation'`), as Firestore's do; `create` fails if the
 * document exists, with Firestore's ALREADY_EXISTS code.
 */
export function fakeDb(
  docs: Record<string, Doc>,
  opts: {
    beforeCommit?: (store: Map<string, Doc>, attempt: number) => void;
    blackouts?: Array<Record<string, unknown>>;
    /** Other collections' starting documents, by collection then id. */
    others?: Record<string, Record<string, Doc>>;
  } = {},
) {
  const store = new Map(Object.entries(docs));
  const collections = new Map<string, Map<string, Doc>>([['bookings', store]]);
  for (const [name, initial] of Object.entries(opts.others ?? {})) {
    collections.set(name, new Map(Object.entries(initial)));
  }
  const coll = (name: string) => {
    let c = collections.get(name);
    if (!c) {
      c = new Map();
      collections.set(name, c);
    }
    return c;
  };
  const commits: Array<{ reads: string[]; writes: string[] }> = [];
  const isDelete = (v: unknown) => v instanceof FieldValue && v.isEqual(FieldValue.delete());
  const isPlain = (v: unknown): v is Record<string, unknown> =>
    !!v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype;
  /** Sets (or deletes) one dotted path, copying the objects along it. */
  const setPath = (target: Doc, path: string, value: unknown) => {
    const keys = path.split('.');
    let cur: Record<string, unknown> = target;
    for (const k of keys.slice(0, -1)) {
      cur[k] = isPlain(cur[k]) ? { ...(cur[k] as Record<string, unknown>) } : {};
      cur = cur[k] as Record<string, unknown>;
    }
    const last = keys[keys.length - 1]!;
    if (isDelete(value)) delete cur[last];
    else cur[last] = value;
  };
  /** Merges an update, dropping fields set to FieldValue.delete(). */
  const mergeIn = (c: Map<string, Doc>, id: string, data: Doc) => {
    const next: Doc = { ...c.get(id) };
    for (const [k, v] of Object.entries(data)) setPath(next, k, v);
    c.set(id, next);
  };
  /** `set(…, { merge: true })`: nested objects merge instead of replacing. */
  const deepMerge = (c: Map<string, Doc>, id: string, data: Doc) => {
    const walk = (target: Record<string, unknown>, src: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(src)) {
        if (isDelete(v)) delete target[k];
        else if (isPlain(v) && isPlain(target[k])) {
          target[k] = { ...(target[k] as Record<string, unknown>) };
          walk(target[k] as Record<string, unknown>, v);
        } else target[k] = v;
      }
    };
    const next: Doc = { ...c.get(id) };
    walk(next, data);
    c.set(id, next);
  };
  const alreadyExists = () => Object.assign(new Error('ALREADY_EXISTS'), { code: 6 });
  const ref = (name: string, id: string) => {
    const c = coll(name);
    return {
      id,
      path: `${name}/${id}`,
      collection: name,
      peek: () => c.get(id) ?? null,
      get: async () => ({ id, exists: c.has(id), data: () => (c.has(id) ? { ...c.get(id) } : undefined) }),
      update: async (data: Doc) => {
        assert.ok(c.has(id), name === 'bookings' ? `no booking ${id} to update` : `no ${name}/${id} to update`);
        mergeIn(c, id, data);
      },
      set: async (data: Doc, o?: { merge?: boolean }) => {
        if (o?.merge) deepMerge(c, id, data);
        else c.set(id, { ...data });
      },
      create: async (data: Doc) => {
        if (c.has(id)) throw alreadyExists();
        c.set(id, { ...data });
      },
      delete: async () => {
        c.delete(id);
      },
    };
  };
  type Ref = ReturnType<typeof ref>;
  const field = (d: Record<string, unknown>, path: string): unknown =>
    path.split('.').reduce<unknown>((v, k) => (v && typeof v === 'object' ? (v as Record<string, unknown>)[k] : undefined), d);
  const compare: Record<string, (a: unknown, b: unknown) => boolean> = {
    '==': (a, b) => a === b,
    '<': (a, b) => a !== undefined && (a as string) < (b as string),
    '<=': (a, b) => a !== undefined && (a as string) <= (b as string),
    '>': (a, b) => a !== undefined && (a as string) > (b as string),
    '>=': (a, b) => a !== undefined && (a as string) >= (b as string),
  };
  const query = (name: string) => (path: string, op: string, value: unknown) => {
    assert.ok(compare[op], `unsupported where op ${op}`);
    const c = coll(name);
    const matches = () => [...c.entries()].filter(([, d]) => compare[op]!(field(d, path), value));
    return {
      path: `${name} where ${path} ${op} ${String(value)}`,
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
  type Readable = Ref | ReturnType<ReturnType<typeof query>> | ReturnType<typeof blackoutQuery>;
  type Write =
    | { op: 'update'; r: Ref; data: Doc }
    | { op: 'set'; r: Ref; data: Doc; merge: boolean }
    | { op: 'delete'; r: Ref };
  const db = {
    collection: (name: string) => {
      if (name === 'blackouts') return { where: blackoutQuery };
      return { doc: (id: string) => ref(name, id), where: query(name) };
    },
    runTransaction: async <T>(fn: (tx: unknown) => Promise<T>) => {
      for (let attempt = 1; attempt <= 5; attempt++) {
        const reads: Array<{ r: Readable; seen: string }> = [];
        const writes: Write[] = [];
        const result = await fn({
          get: (r: Readable) => {
            assert.equal(writes.length, 0, 'a Firestore transaction reads before it writes');
            reads.push({ r, seen: JSON.stringify(r.peek()) });
            return r.get();
          },
          update: (r: Ref, data: Doc) => {
            writes.push({ op: 'update', r, data });
          },
          set: (r: Ref, data: Doc, o?: { merge?: boolean }) => {
            writes.push({ op: 'set', r, data, merge: !!o?.merge });
          },
          delete: (r: Ref) => {
            writes.push({ op: 'delete', r });
          },
        });
        opts.beforeCommit?.(store, attempt);
        if (reads.some(({ r, seen }) => JSON.stringify(r.peek()) !== seen)) continue;
        for (const w of writes) {
          const c = coll(w.r.collection);
          if (w.op === 'update') mergeIn(c, w.r.id, w.data);
          else if (w.op === 'delete') c.delete(w.r.id);
          else if (w.merge) deepMerge(c, w.r.id, w.data);
          else c.set(w.r.id, { ...w.data });
        }
        commits.push({ reads: reads.map(({ r }) => r.path), writes: writes.map((w) => w.r.path) });
        return result;
      }
      throw new Error('Transaction kept conflicting');
    },
  };
  return { db: db as unknown as Firestore, store, collections, coll, commits };
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

/** Resend's emails.send: hands out ids, or the error it's told to. */
export function fakeResend(opts: { fail?: { name: string; message: string } | ((n: number) => { name: string; message: string } | null) } = {}) {
  const sent: Array<{ payload: CreateEmailOptions; options?: CreateEmailRequestOptions }> = [];
  const resend = {
    emails: {
      async send(payload: CreateEmailOptions, options?: CreateEmailRequestOptions) {
        const fail = typeof opts.fail === 'function' ? opts.fail(sent.length + 1) : opts.fail;
        sent.push({ payload, options });
        if (fail) return { data: null, error: fail };
        return { data: { id: `em_${sent.length}` }, error: null };
      },
    },
  } as unknown as NonNullable<EmailDeps['resend']>;
  return { resend, sent };
}

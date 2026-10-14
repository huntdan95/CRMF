/**
 * Travis refunding part of a payment from the booking page, against
 * in-memory stand-ins for Firestore and Stripe. Run with `npm test` in
 * functions/.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type Stripe from 'stripe';

import { adminPartialRefundOne } from '../src/lib/admin-refund';
import { TOKEN, fakeDb, type Doc } from './fakes';

const R1 = '0b9a3c3e-5f4e-4c1a-9a43-0c6f3c1d2e01';
const R2 = '0b9a3c3e-5f4e-4c1a-9a43-0c6f3c1d2e02';
const ADMIN = 'travis@example.com';

/**
 * Refunds against one charge, like Stripe's: a key used again with the
 * same request returns the saved response, and with a different one fails.
 */
function fakeRefunds(alreadyRefundedCents = 0) {
  let refundedCents = alreadyRefundedCents;
  const saved = new Map<string, { request: string; response: unknown }>();
  const created: Array<{ amount: number; key: string }> = [];
  const stripe = {
    refunds: {
      create: async (params: { amount: number }, opts: { idempotencyKey: string }) => {
        const request = JSON.stringify(params);
        const earlier = saved.get(opts.idempotencyKey);
        if (earlier) {
          if (earlier.request !== request) {
            throw Object.assign(new Error('Keys for idempotent requests can only be used with the same parameters'), {
              type: 'StripeIdempotencyError',
            });
          }
          return earlier.response;
        }
        refundedCents += params.amount;
        created.push({ amount: params.amount, key: opts.idempotencyKey });
        const response = { id: `re_${created.length}`, charge: { id: 'ch_1', amount_refunded: refundedCents } };
        saved.set(opts.idempotencyKey, { request, response });
        return response;
      },
    },
  } as unknown as Pick<Stripe, 'refunds'>;
  return { stripe, created };
}

/** A Firestore write that fails once, the first time a transaction commits. */
function failFirstCommit() {
  let failed = false;
  return () => {
    if (failed) return;
    failed = true;
    throw new Error('Firestore unavailable');
  };
}

const paid: Doc = {
  id: 'b1',
  tourId: 'morning-shared',
  date: '2099-07-04',
  status: 'confirmed',
  paymentStatus: 'paid',
  amountPaidCents: 20000,
  amountRefundedCents: 0,
  stripePaymentIntentId: 'pi_1',
  customerName: 'Pat Example',
  customerEmail: 'pat@example.com',
  accessToken: TOKEN,
};

describe('adminPartialRefundOne', () => {
  test('refunds through Stripe under the refund window’s request id', async () => {
    const { db, store } = fakeDb({ b1: paid });
    const { stripe, created } = fakeRefunds();

    const r = await adminPartialRefundOne('b1', { amountCents: 5000, requestId: R1, adminEmail: ADMIN }, { db, stripe });

    assert.deepEqual(r, { kind: 'refunded', refundCents: 5000, stripeRefundId: 're_1', repeat: false });
    assert.deepEqual(created, [{ amount: 5000, key: `partial-b1-${R1}` }]);
    const b = store.get('b1')!;
    assert.equal(b.amountRefundedCents, 5000);
    assert.equal(b.paymentStatus, 'partial-refund');
    assert.deepEqual(b.refundRequests, { [R1]: { refundCents: 5000, stripeRefundId: 're_1' } });
  });

  test('tapping again after a dropped connection doesn’t refund twice', async () => {
    const { db, store } = fakeDb({ b1: paid });
    const { stripe, created } = fakeRefunds();
    const req = { amountCents: 5000, requestId: R1, adminEmail: ADMIN };

    await adminPartialRefundOne('b1', req, { db, stripe });
    const again = await adminPartialRefundOne('b1', req, { db, stripe });

    assert.deepEqual(again, { kind: 'refunded', refundCents: 5000, stripeRefundId: 're_1', repeat: true });
    assert.equal(created.length, 1);
    assert.equal(store.get('b1')!.amountRefundedCents, 5000);
  });

  test('a repeat is reported as done even when it is more than is now left', async () => {
    const { db } = fakeDb({ b1: paid });
    const { stripe, created } = fakeRefunds();
    const req = { amountCents: 20000, requestId: R1, adminEmail: ADMIN };

    await adminPartialRefundOne('b1', req, { db, stripe });
    const again = await adminPartialRefundOne('b1', req, { db, stripe });

    assert.equal(again.kind, 'refunded');
    assert.equal(created.length, 1);
  });

  test('if the refund reached Stripe but the booking wasn’t updated, a retry records it once', async () => {
    const { db, store } = fakeDb({ b1: paid }, { beforeCommit: failFirstCommit() });
    const { stripe, created } = fakeRefunds();
    const req = { amountCents: 5000, requestId: R1, adminEmail: ADMIN };

    await assert.rejects(adminPartialRefundOne('b1', req, { db, stripe }), /Firestore unavailable/);
    assert.equal(store.get('b1')!.amountRefundedCents, 0);
    // Stripe's webhook reports the refund before Travis taps again.
    store.set('b1', { ...store.get('b1'), amountRefundedCents: 5000, paymentStatus: 'partial-refund' });

    const r = await adminPartialRefundOne('b1', req, { db, stripe });

    assert.equal(r.kind, 'refunded');
    assert.equal(created.length, 1, 'Stripe refunded once');
    assert.equal(store.get('b1')!.amountRefundedCents, 5000, 'and the booking counts it once');
  });

  test('Stripe’s webhook landing first doesn’t make the refund count twice', async () => {
    const { db, store } = fakeDb(
      { b1: paid },
      {
        beforeCommit: (s, attempt) => {
          if (attempt === 1) s.set('b1', { ...s.get('b1'), amountRefundedCents: 5000, paymentStatus: 'partial-refund' });
        },
      },
    );
    const { stripe } = fakeRefunds();

    await adminPartialRefundOne('b1', { amountCents: 5000, requestId: R1, adminEmail: ADMIN }, { db, stripe });

    assert.equal(store.get('b1')!.amountRefundedCents, 5000);
  });

  test('two separate refunds add up, and the booking is refunded once they reach what was paid', async () => {
    const { db, store } = fakeDb({ b1: paid });
    const { stripe, created } = fakeRefunds();

    await adminPartialRefundOne('b1', { amountCents: 5000, requestId: R1, adminEmail: ADMIN }, { db, stripe });
    assert.equal(store.get('b1')!.paymentStatus, 'partial-refund');
    await adminPartialRefundOne('b1', { amountCents: 15000, requestId: R2, adminEmail: ADMIN }, { db, stripe });

    assert.equal(created.length, 2);
    assert.equal(store.get('b1')!.amountRefundedCents, 20000);
    assert.equal(store.get('b1')!.paymentStatus, 'refunded');
  });

  test('refuses more than is left, without going to Stripe', async () => {
    const { db, store } = fakeDb({ b1: { ...paid, amountRefundedCents: 15000, paymentStatus: 'partial-refund' } });
    const { stripe, created } = fakeRefunds(15000);

    const r = await adminPartialRefundOne('b1', { amountCents: 6000, requestId: R1, adminEmail: ADMIN }, { db, stripe });

    assert.deepEqual(r, { kind: 'too-much', refundableCents: 5000 });
    assert.equal(created.length, 0);
    assert.equal(store.get('b1')!.amountRefundedCents, 15000);
  });

  test('a different amount under a request id Stripe already used is refused, not refunded again', async () => {
    const { db, store } = fakeDb({ b1: paid }, { beforeCommit: failFirstCommit() });
    const { stripe, created } = fakeRefunds();

    await assert.rejects(
      adminPartialRefundOne('b1', { amountCents: 5000, requestId: R1, adminEmail: ADMIN }, { db, stripe }),
    );
    const r = await adminPartialRefundOne('b1', { amountCents: 6000, requestId: R1, adminEmail: ADMIN }, { db, stripe });

    assert.deepEqual(r, { kind: 'key-reused' });
    assert.equal(created.length, 1);
    assert.equal(store.get('b1')!.amountRefundedCents, 0);
  });

  test('a booking with no Stripe payment (old website) can’t be refunded here', async () => {
    const { db } = fakeDb({ b1: { ...paid, stripePaymentIntentId: undefined, legacy: { bookingId: 7 } } });
    const { stripe, created } = fakeRefunds();

    const r = await adminPartialRefundOne('b1', { amountCents: 5000, requestId: R1, adminEmail: ADMIN }, { db, stripe });

    assert.deepEqual(r, { kind: 'no-stripe-payment' });
    assert.equal(created.length, 0);
  });

  test('a missing booking', async () => {
    const { db } = fakeDb({});
    const { stripe } = fakeRefunds();
    const r = await adminPartialRefundOne('nope', { amountCents: 5000, requestId: R1, adminEmail: ADMIN }, { db, stripe });
    assert.deepEqual(r, { kind: 'not-found' });
  });
});

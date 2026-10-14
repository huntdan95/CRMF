/**
 * A customer cancelling a booking they've paid for, including after Travis
 * already refunded part of it, against in-memory stand-ins for Firestore,
 * Stripe and email. Run with `npm test` in functions/.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { cancelPaidBooking } from '../src/cancelBooking';
import { quoteCustomerRefund, zonedTimeToUtc } from '../src/lib/datetime';
import type { CancellationMailer } from '../src/lib/admin-cancel';
import type { Booking } from '../src/lib/types';
import { TOKEN, failFirstCommit, fakeDb, fakeRefunds, type Doc } from './fakes';

const TOUR_DATE = '2099-07-04';
const START = '08:00';
const hoursBefore = (h: number) => new Date(zonedTimeToUtc(TOUR_DATE, START).getTime() - h * 3600_000);

/** Stripe, with any refund Travis already gave on the booking's payment. */
function stripeFor(doc: Doc) {
  const earlier = doc.amountRefundedCents
    ? [{ amount: doc.amountRefundedCents, metadata: { bookingId: 'b1', refundType: 'partial' } }]
    : [];
  return fakeRefunds({ earlier });
}

function mailer() {
  const sent: Array<{ to: string; text: string }> = [];
  const m: CancellationMailer = {
    marina: { name: 'Marina', address: '1 Dock St' },
    phoneDisplay: '352-586-7792',
    async send({ to, text }) {
      sent.push({ to, text });
    },
  };
  return { mailer: m, sent };
}

const paid: Doc = {
  id: 'b1',
  tourId: 'morning-shared',
  tourName: 'Morning Shared',
  date: TOUR_DATE,
  timeSlot: 'morning',
  type: 'shared',
  guestCount: 4,
  guests: [],
  customerName: 'Pat Example',
  customerEmail: 'pat@example.com',
  accessToken: TOKEN,
  status: 'confirmed',
  paymentStatus: 'paid',
  amountPaidCents: 20000,
  amountRefundedCents: 0,
  stripePaymentIntentId: 'pi_1',
};
/** Travis already gave $50 back, say for a guest who dropped out. */
const partlyRefunded: Doc = { ...paid, amountRefundedCents: 5000, paymentStatus: 'partial-refund' };

async function cancel(doc: Doc, hoursAhead: number) {
  const { db, store } = fakeDb({ b1: doc });
  const { stripe, created: refunds } = stripeFor(doc);
  const { mailer: m, sent } = mailer();
  const result = await cancelPaidBooking(
    'b1',
    doc as Booking,
    { reason: 'Plans changed', startTime: START, now: hoursBefore(hoursAhead) },
    { db, stripe, mailer: m },
  );
  return { result, refunds, sent, after: store.get('b1')! };
}

describe('quoteCustomerRefund', () => {
  test('applies the policy to what is left after an earlier refund', () => {
    const quote = (h: number, refunded: number) =>
      quoteCustomerRefund({ amountPaidCents: 20000, amountRefundedCents: refunded, date: TOUR_DATE, startTime: START, now: hoursBefore(h) });
    assert.equal(quote(100, 0).refundCents, 20000);
    assert.equal(quote(100, 5000).refundCents, 15000);
    assert.equal(quote(48, 5000).refundCents, 7500);
    assert.equal(quote(48, 5000).refundPercent, 50);
    assert.equal(quote(100, 20000).refundCents, 0);
    assert.equal(quote(100, 25000).refundCents, 0, 'never negative');
    assert.equal(quote(12, 5000).refundCents, 0);
  });
});

describe('cancelPaidBooking', () => {
  test('72+ hours out, refunds everything that’s left after Travis’s earlier refund', async () => {
    const { result, refunds, sent, after } = await cancel(partlyRefunded, 100);

    assert.deepEqual(refunds, [{ amount: 15000, key: 'cancel-b1' }]);
    assert.equal(result.quote.refundCents, 15000);
    assert.equal(after.status, 'cancelled');
    assert.equal(after.amountRefundedCents, 20000);
    assert.equal(after.paymentStatus, 'refunded');
    assert.match(sent[0]!.text, /The remaining \$150 of your \$200 payment has been refunded to your card \(\$50 was refunded earlier\)/);
  });

  test('24–72 hours out, refunds half of what’s left, and the email says so', async () => {
    const { refunds, sent, after } = await cancel(partlyRefunded, 48);

    assert.deepEqual(refunds, [{ amount: 7500, key: 'cancel-b1' }]);
    assert.equal(after.amountRefundedCents, 12500);
    assert.equal(after.paymentStatus, 'partial-refund');
    assert.match(sent[0]!.text, /A 50% refund of \$75 has been issued to your card: 50% of the \$150 left after an earlier \$50 refund \(you paid \$200\)/);
  });

  test('with no earlier refund, nothing changes', async () => {
    const full = await cancel(paid, 100);
    assert.deepEqual(full.refunds, [{ amount: 20000, key: 'cancel-b1' }]);
    assert.equal(full.after.paymentStatus, 'refunded');
    assert.match(full.sent[0]!.text, /A full refund of \$200 has been issued to your card/);

    const half = await cancel(paid, 48);
    assert.deepEqual(half.refunds, [{ amount: 10000, key: 'cancel-b1' }]);
    assert.equal(half.after.paymentStatus, 'partial-refund');
    assert.match(half.sent[0]!.text, /A 50% refund of \$100 has been issued to your card \(you paid \$200\)/);
  });

  test('if Travis already refunded all of it, Stripe isn’t asked for more', async () => {
    const { refunds, sent, after } = await cancel({ ...paid, amountRefundedCents: 20000, paymentStatus: 'refunded' }, 100);

    assert.equal(refunds.length, 0);
    assert.equal(after.status, 'cancelled');
    assert.equal(after.amountRefundedCents, 20000);
    assert.equal(after.paymentStatus, 'refunded');
    assert.match(sent[0]!.text, /Your payment has already been refunded\./);
  });

  test('under 24 hours, no refund', async () => {
    const { refunds, sent, after } = await cancel(partlyRefunded, 12);

    assert.equal(refunds.length, 0);
    assert.equal(after.status, 'cancelled');
    assert.equal(after.amountRefundedCents, 5000);
    assert.equal(after.paymentStatus, 'partial-refund');
    assert.match(sent[0]!.text, /Per our policy, no refund is being issued/);
  });

  test('Stripe’s webhook landing first doesn’t make the refund count twice', async () => {
    const { db, store } = fakeDb(
      { b1: partlyRefunded },
      {
        // charge.refunded reports the payment's whole refunded total.
        beforeCommit: (s, attempt) => {
          if (attempt === 1) s.set('b1', { ...s.get('b1'), amountRefundedCents: 20000, paymentStatus: 'refunded' });
        },
      },
    );
    const { stripe } = stripeFor(partlyRefunded);
    const { mailer: m } = mailer();

    await cancelPaidBooking('b1', partlyRefunded as Booking, { reason: undefined, startTime: START, now: hoursBefore(100) }, { db, stripe, mailer: m });

    assert.equal(store.get('b1')!.amountRefundedCents, 20000);
    assert.equal(store.get('b1')!.paymentStatus, 'refunded');
  });
});

/**
 * Stripe took the refund, but the booking couldn't be marked cancelled, so
 * the customer tries again: by then, maybe on the other side of a policy line.
 */
describe('cancelPaidBooking, tried again after Stripe took the refund', () => {
  async function failThenRetry(
    doc: Doc,
    firstHoursAhead: number,
    retryHoursAhead: number,
    meanwhile: (s: { store: Map<string, Doc>; refundedCents: () => number; forgetKeys: () => void }) => void = () => {},
  ) {
    const { db, store } = fakeDb({ b1: doc }, { beforeCommit: failFirstCommit() });
    const { stripe, created, refundedCents, forgetKeys } = stripeFor(doc);
    const { mailer: m, sent } = mailer();
    const at = (h: number) => ({ reason: 'Plans changed', startTime: START, now: hoursBefore(h) });

    await assert.rejects(
      cancelPaidBooking('b1', doc as Booking, at(firstHoursAhead), { db, stripe, mailer: m }),
      /Firestore unavailable/,
    );
    assert.equal(store.get('b1')!.status, 'confirmed');
    meanwhile({ store, refundedCents, forgetKeys });

    const result = await cancelPaidBooking('b1', store.get('b1') as Booking, at(retryHoursAhead), { db, stripe, mailer: m });
    return { result, refunds: created, sent, after: store.get('b1')! };
  }

  /** What stripeWebhook's charge.refunded handler writes. */
  const webhookLands = ({ store, refundedCents }: { store: Map<string, Doc>; refundedCents: () => number }) =>
    store.set('b1', {
      ...store.get('b1'),
      amountRefundedCents: refundedCents(),
      paymentStatus: refundedCents() >= 20000 ? 'refunded' : 'partial-refund',
    });

  test('across the 72-hour line, it records the full refund already made', async () => {
    const { result, refunds, sent, after } = await failThenRetry(paid, 73, 71);

    assert.deepEqual(refunds, [{ amount: 20000, key: 'cancel-b1' }], 'Stripe refunded once');
    assert.deepEqual(result.quote, { tier: 'full', refundPercent: 100, refundCents: 20000 });
    assert.equal(result.refundId, 're_1');
    assert.equal(after.status, 'cancelled');
    assert.equal(after.amountRefundedCents, 20000);
    assert.equal(after.paymentStatus, 'refunded');
    assert.match(sent[0]!.text, /A full refund of \$200 has been issued to your card/);
  });

  test('after Stripe’s webhook recorded it, the email still tells it straight', async () => {
    const { result, refunds, sent, after } = await failThenRetry(partlyRefunded, 73, 71, webhookLands);

    assert.deepEqual(refunds, [{ amount: 15000, key: 'cancel-b1' }]);
    assert.equal(result.quote.refundCents, 15000);
    assert.equal(after.status, 'cancelled');
    assert.equal(after.amountRefundedCents, 20000);
    assert.equal(after.paymentStatus, 'refunded');
    assert.match(sent[0]!.text, /The remaining \$150 of your \$200 payment has been refunded to your card \(\$50 was refunded earlier\)/);
  });

  test('across the 24-hour line, it records the half refund already made, not “no refund”', async () => {
    const { result, refunds, sent, after } = await failThenRetry(paid, 25, 23);

    assert.equal(refunds.length, 1);
    assert.deepEqual(result.quote, { tier: 'half', refundPercent: 50, refundCents: 10000 });
    assert.equal(after.amountRefundedCents, 10000);
    assert.equal(after.paymentStatus, 'partial-refund');
    assert.match(sent[0]!.text, /A 50% refund of \$100 has been issued to your card \(you paid \$200\)/);
  });

  test('a day later, when Stripe has forgotten the key, it doesn’t refund again', async () => {
    const { refunds, after } = await failThenRetry(paid, 60, 35, (s) => {
      webhookLands(s);
      s.forgetKeys();
    });

    assert.deepEqual(refunds, [{ amount: 10000, key: 'cancel-b1' }]);
    assert.equal(after.status, 'cancelled');
    assert.equal(after.amountRefundedCents, 10000);
  });
});

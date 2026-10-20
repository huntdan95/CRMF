/**
 * A customer cancelling a booking they've paid for, including after Travis
 * already refunded part of it, against in-memory stand-ins for Firestore,
 * Stripe and email. Run with `npm test` in functions/.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Request } from 'firebase-functions/v2/https';

import { cancelBooking, cancelPaidBooking } from '../src/cancelBooking';
import { fetchBooking } from '../src/fetchBooking';
import { db as liveDb } from '../src/lib/firebase';
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

async function cancel(doc: Doc, hoursAhead: number, expectedRefundCents?: number) {
  const { db, store } = fakeDb({ b1: doc });
  const { stripe, created: refunds } = stripeFor(doc);
  const { mailer: m, sent } = mailer();
  const result = await cancelPaidBooking(
    'b1',
    doc as Booking,
    { reason: 'Plans changed', startTime: START, expectedRefundCents, now: hoursBefore(hoursAhead) },
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
    assert.equal(quote(71, 5000).refundCents, 0, 'nothing back under 72 hours');
    assert.equal(quote(71, 5000).refundPercent, 0);
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

  test('under 72 hours, no refund, and the email says so', async () => {
    const { refunds, sent, after } = await cancel(partlyRefunded, 48);

    assert.equal(refunds.length, 0);
    assert.equal(after.status, 'cancelled');
    assert.equal(after.amountRefundedCents, 5000);
    assert.equal(after.paymentStatus, 'partial-refund');
    assert.match(sent[0]!.text, /Per our policy, no refund is being issued/);
  });

  test('with no earlier refund, nothing changes', async () => {
    const full = await cancel(paid, 100);
    assert.deepEqual(full.refunds, [{ amount: 20000, key: 'cancel-b1' }]);
    assert.equal(full.after.paymentStatus, 'refunded');
    assert.match(full.sent[0]!.text, /A full refund of \$200 has been issued to your card/);

    const none = await cancel(paid, 48);
    assert.equal(none.refunds.length, 0);
    assert.equal(none.after.amountRefundedCents, 0);
    assert.match(none.sent[0]!.text, /Per our policy, no refund is being issued/);
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
 * The dialog sends the refund it showed. It may have sat open across the
 * 72-hour line, or worked it out on a wrong clock.
 */
describe('cancelPaidBooking, with the refund the customer was shown', () => {
  test('a refund lower than the one shown cancels nothing, and says what it is now', async () => {
    const { result, refunds, sent, after } = await cancel(paid, 71.5, 20000);

    assert.equal(result.kind, 'refund-changed');
    assert.equal(result.quote.refundCents, 0);
    assert.equal(refunds.length, 0);
    assert.equal(sent.length, 0, 'no cancellation email');
    assert.equal(after.status, 'confirmed');
    assert.equal(after.amountRefundedCents, 0);
  });

  test('confirming again at the new amount cancels', async () => {
    const { result, refunds, after } = await cancel(paid, 71.5, 0);

    assert.equal(result.kind, 'cancelled');
    assert.equal(refunds.length, 0);
    assert.equal(after.status, 'cancelled');
  });

  test('the amount shown, or more, goes ahead', async () => {
    const same = await cancel(paid, 100, 20000);
    assert.equal(same.result.kind, 'cancelled');
    assert.deepEqual(same.refunds, [{ amount: 20000, key: 'cancel-b1' }]);

    // Their clock said under 72 hours; the marina's says otherwise.
    const more = await cancel(paid, 100, 0);
    assert.equal(more.result.kind, 'cancelled');
    assert.deepEqual(more.refunds, [{ amount: 20000, key: 'cancel-b1' }]);
  });

  test('a refund already in Stripe from an earlier try isn’t held back', async () => {
    const { db, store } = fakeDb({ b1: paid });
    const { stripe, created } = fakeRefunds({
      earlier: [{ amount: 10000, metadata: { bookingId: 'b1', cancelledBy: 'customer', policyTier: 'half' } }],
    });
    const { mailer: m } = mailer();

    const result = await cancelPaidBooking(
      'b1',
      paid as Booking,
      { reason: undefined, startTime: START, expectedRefundCents: 20000, now: hoursBefore(100) },
      { db, stripe, mailer: m },
    );

    assert.equal(result.kind, 'cancelled');
    assert.equal(created.length, 0, 'no new refund');
    assert.equal(store.get('b1')!.status, 'cancelled');
    assert.equal(store.get('b1')!.amountRefundedCents, 10000);
  });
});

/**
 * Travis closed the trip with "pick a new date or a full refund", then
 * reopened it and put them back on (lib/close-day.ts). The offer's deadline
 * still stands: until the end of that day, marina time, cancelling refunds
 * in full, whatever the 72-hour policy says.
 */
describe('cancelPaidBooking, on a trip Travis reopened', () => {
  // 11:59 PM and midnight at the marina (EDT) going into July 3: 32 hours
  // and a minute, and 32 hours, before the 8:00 on July 4.
  const lastMinute = new Date('2099-07-03T03:59:00Z');
  const nextDay = new Date('2099-07-03T04:00:00Z');
  const reopened = (doc: Doc, graceUntil: string): Doc => ({ ...doc, refundGraceUntil: graceUntil });

  async function cancelAt(doc: Doc, now: Date, expectedRefundCents?: number) {
    const { db, store } = fakeDb({ b1: doc });
    const { stripe, created: refunds } = stripeFor(doc);
    const { mailer: m, sent } = mailer();
    const result = await cancelPaidBooking('b1', doc as Booking, { reason: 'Plans changed', startTime: START, expectedRefundCents, now }, { db, stripe, mailer: m });
    return { result, refunds, sent, after: store.get('b1')! };
  }

  test('under 72 hours, everything left is refunded until the deadline, and the amount the dialog showed goes through', async () => {
    const { result, refunds, sent, after } = await cancelAt(reopened(partlyRefunded, '2099-07-02'), lastMinute, 15000);

    assert.ok(result.kind === 'cancelled');
    assert.deepEqual(result.quote, { tier: 'full', refundPercent: 100, refundCents: 15000, hoursUntilTour: 32 + 1 / 60, explanation: 'Travis reopened your trip; you can still cancel for a full refund until Thursday, July 2, 2099.' });
    assert.deepEqual(refunds, [{ amount: 15000, key: 'cancel-b1' }]);
    assert.equal(after.status, 'cancelled');
    assert.equal(after.amountRefundedCents, 20000);
    assert.equal(after.paymentStatus, 'refunded');
    assert.match(sent[0]!.text, /The remaining \$150 of your \$200 payment has been refunded to your card/);
  });

  test('from midnight after the deadline it’s the policy again: the full refund the dialog showed cancels nothing', async () => {
    const stale = await cancelAt(reopened(paid, '2099-07-02'), nextDay, 20000);
    assert.ok(stale.result.kind === 'refund-changed');
    assert.equal(stale.result.quote.refundCents, 0);
    assert.equal(stale.result.quote.explanation, 'Less than 72 hours before your tour — no refund.');
    assert.equal(stale.refunds.length, 0);
    assert.equal(stale.after.status, 'confirmed');

    // Confirming again at the new amount.
    const again = await cancelAt(reopened(paid, '2099-07-02'), nextDay, 0);
    assert.equal(again.result.kind, 'cancelled');
    assert.equal(again.refunds.length, 0);
    assert.match(again.sent[0]!.text, /Per our policy, no refund is being issued/);
  });

  test('a deadline after the trip says “until it leaves”, and nothing comes back once it has', () => {
    const quote = (h: number) =>
      quoteCustomerRefund({ amountPaidCents: 20000, date: TOUR_DATE, startTime: START, now: hoursBefore(h), refundGraceUntil: '2099-07-07' });
    assert.equal(quote(1).refundCents, 20000);
    assert.equal(quote(1).explanation, 'Travis reopened your trip; you can still cancel for a full refund until it leaves.');
    assert.equal(quote(-0.5).refundCents, 0);
    assert.equal(quote(-0.5).tier, 'none');
    // 72 hours or more out it's a full refund anyway, and says so as usual.
    assert.equal(quote(100).explanation, '72+ hours before your tour — full refund.');
  });

  test('without one (never reopened, or Travis moved it since), the usual policy', async () => {
    for (const doc of [paid, { ...paid, refundGraceUntil: undefined }]) {
      const { result, refunds } = await cancelAt(doc, lastMinute, 20000);
      assert.equal(result.kind, 'refund-changed');
      assert.equal(refunds.length, 0);
    }
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
    assert.ok(result.kind === 'cancelled');
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

  test('a 50% refund made under the old 24–72-hour tier is recorded as such, not “no refund”', async () => {
    const { db, store } = fakeDb({ b1: paid });
    const { stripe, created } = fakeRefunds({
      earlier: [{ amount: 10000, metadata: { bookingId: 'b1', cancelledBy: 'customer', policyTier: 'half' } }],
    });
    const { mailer: m, sent } = mailer();

    const result = await cancelPaidBooking('b1', paid as Booking, { reason: 'Plans changed', startTime: START, now: hoursBefore(23) }, { db, stripe, mailer: m });

    assert.equal(created.length, 0, 'no new refund');
    assert.deepEqual(result.quote, { tier: 'half', refundPercent: 50, refundCents: 10000 });
    assert.equal(store.get('b1')!.amountRefundedCents, 10000);
    assert.equal(store.get('b1')!.paymentStatus, 'partial-refund');
    assert.match(sent[0]!.text, /A 50% refund of \$100 has been issued to your card \(you paid \$200\)/);
  });

  test('a day later, when Stripe has forgotten the key, it doesn’t refund again', async () => {
    const { refunds, after } = await failThenRetry(paid, 80, 50, (s) => {
      webhookLands(s);
      s.forgetKeys();
    });

    assert.deepEqual(refunds, [{ amount: 20000, key: 'cancel-b1' }]);
    assert.equal(after.status, 'cancelled');
    assert.equal(after.amountRefundedCents, 20000);
  });
});

/**
 * cancelBooking checks first that Travis isn't closing the trip, and only
 * then goes to Stripe and writes the cancel: he, or the closure, can get
 * there in between.
 */
describe('cancelPaidBooking, racing Travis', () => {
  const closing = (over: Doc = {}) => ({
    closureActions: { bo1: { date: TOUR_DATE, affectedSlots: ['morning'], state: 'pending', choice: 'offer', ...over } },
  });

  async function cancelWith(others: Record<string, Record<string, Doc>>, hoursAhead: number) {
    const { db, store } = fakeDb({ b1: paid }, { others });
    const { stripe, created } = stripeFor(paid);
    const { mailer: m, sent } = mailer();
    const result = await cancelPaidBooking('b1', paid as Booking, { reason: 'Plans changed', startTime: START, now: hoursBefore(hoursAhead) }, { db, stripe, mailer: m });
    return { result, refunds: created, sent, after: store.get('b1')! };
  }

  test('a closure he confirms as they cancel inside 72 hours wins: nothing is cancelled, and the closure refunds them', async () => {
    const { result, refunds, sent, after } = await cancelWith(closing(), 48);

    assert.deepEqual(result, { kind: 'closure-pending', choice: 'offer' });
    assert.equal(refunds.length, 0);
    assert.equal(sent.length, 0);
    assert.equal(after.status, 'confirmed');
  });

  test('not a closure of another departure, nor one that has gone out or been undone', async () => {
    for (const over of [{ affectedSlots: ['late-afternoon'] }, { state: 'done' }, { state: 'undone' }]) {
      const { result, after } = await cancelWith(closing(over), 48);
      assert.equal(result.kind, 'cancelled', JSON.stringify(over));
      assert.equal(after.status, 'cancelled');
    }
  });

  test('once their full refund has gone to Stripe, the cancel goes through to match', async () => {
    const { result, refunds, after } = await cancelWith(closing({ choice: 'cancel' }), 100);

    assert.equal(result.kind, 'cancelled');
    assert.deepEqual(refunds, [{ amount: 20000, key: 'cancel-b1' }]);
    assert.equal(after.status, 'cancelled');
    assert.equal(after.amountRefundedCents, 20000);
  });

  test('Travis cancelling it first: theirs stands, and the customer isn’t told “no refund”', async () => {
    const { db, store } = fakeDb(
      { b1: paid },
      {
        beforeCommit: (s, attempt) => {
          if (attempt === 1) {
            s.set('b1', { ...s.get('b1'), status: 'cancelled', cancelledBy: 'admin', amountRefundedCents: 20000, paymentStatus: 'refunded' });
          }
        },
      },
    );
    const { stripe, created } = stripeFor(paid);
    const { mailer: m, sent } = mailer();

    const result = await cancelPaidBooking('b1', paid as Booking, { reason: 'Plans changed', startTime: START, now: hoursBefore(48) }, { db, stripe, mailer: m });

    assert.deepEqual(result, { kind: 'already-cancelled' });
    assert.equal(created.length, 0);
    assert.equal(sent.length, 0);
    assert.equal(store.get('b1')!.cancelledBy, 'admin');
    assert.equal(store.get('b1')!.cancellationReason, undefined);
  });
});

/**
 * Travis closed the departure and left them booked ("leave them booked",
 * or a day closed from MCP, which only stops new bookings). Once the undo
 * window is over the booking has no closure, only the blackout over its
 * trip. The policy refund isn't what a trip he closed gets, and he's
 * contacting them himself, so a cancel is turned away as it is during the
 * window.
 */
describe('cancelPaidBooking, on a departure Travis closed and left them booked', () => {
  const kept = { closureActions: { bo0: { date: TOUR_DATE, affectedSlots: ['morning'], choice: 'keep', state: 'done' } } };

  async function cancelOn(doc: Doc, closedSlots: string[], now: Date, expectedRefundCents?: number) {
    const { db, store } = fakeDb({ b1: doc }, { blackouts: [{ date: TOUR_DATE, affectedSlots: closedSlots, reason: 'weather' }], others: kept });
    const { stripe, created: refunds } = stripeFor(doc);
    const { mailer: m, sent } = mailer();
    const result = await cancelPaidBooking('b1', doc as Booking, { reason: 'Plans changed', startTime: START, expectedRefundCents, now }, { db, stripe, mailer: m });
    return { result, refunds, sent, after: store.get('b1')! };
  }

  test('inside 72 hours, nothing is cancelled, rather than for no refund', async () => {
    const { result, refunds, sent, after } = await cancelOn(paid, ['morning'], hoursBefore(20), 0);

    assert.deepEqual(result, { kind: 'departure-closed' });
    assert.equal(refunds.length, 0);
    assert.equal(sent.length, 0);
    assert.equal(after.status, 'confirmed');
    assert.equal(after.amountRefundedCents, 0);
  });

  test('the whole day closed, or a whole-day charter under a closed morning, counts the same', async () => {
    assert.equal((await cancelOn(paid, ['all'], hoursBefore(20), 0)).result.kind, 'departure-closed');
    const charter = { ...paid, timeSlot: 'whole-day', tourId: 'whole-day-private' } as Doc;
    assert.equal((await cancelOn(charter, ['mid-morning'], hoursBefore(20), 0)).result.kind, 'departure-closed');
  });

  test('not when the closed departure is another one', async () => {
    const { result, after } = await cancelOn(paid, ['late-afternoon'], hoursBefore(20), 0);
    assert.equal(result.kind, 'cancelled');
    assert.equal(after.status, 'cancelled');
  });

  test('a reopened trip’s full refund still stands until its deadline', async () => {
    const { result, refunds, after } = await cancelOn({ ...paid, refundGraceUntil: '2099-07-04' }, ['morning'], hoursBefore(20), 20000);

    assert.ok(result.kind === 'cancelled');
    assert.equal(result.quote.refundCents, 20000);
    assert.deepEqual(refunds, [{ amount: 20000, key: 'cancel-b1' }]);
    assert.equal(after.status, 'cancelled');
  });
});

describe('cancelBooking and fetchBooking, on a departure Travis closed and left them booked', () => {
  const request = (body: Record<string, unknown>) =>
    ({ method: 'POST', headers: {}, body, header: () => undefined }) as unknown as Request;

  /** Calls an endpoint the way Cloud Functions would and returns its answer. */
  async function call(fn: (req: Request, res: never) => unknown, req: Request) {
    const answer = { status: 200, body: undefined as unknown };
    const res = {
      status(code: number) {
        answer.status = code;
        return res;
      },
      json(body: unknown) {
        answer.body = body;
        return res;
      },
      set: () => res,
      setHeader: () => res,
      getHeader: () => undefined,
      on: () => res,
    };
    await fn(req, res as never);
    return answer;
  }

  const closedMorning = { blackouts: [{ date: TOUR_DATE, affectedSlots: ['morning'], reason: 'weather' }] };
  const departureClosed = async () =>
    ((await call(fetchBooking, request({ bookingId: 'b1', accessToken: TOKEN }))).body as { booking: { departureClosed: boolean } })
      .booking.departureClosed;

  test('the cancel is turned away saying he’ll be in touch, whatever it would refund, and the page is told', async (t) => {
    const { db, store } = fakeDb({ b1: paid }, closedMorning);
    t.mock.method(liveDb, 'collection', db.collection);

    // Years out, so a full refund under the policy: still Travis's to sort out.
    const answer = await call(cancelBooking, request({ bookingId: 'b1', accessToken: TOKEN, expectedRefundCents: 20000 }));
    assert.deepEqual(answer, {
      status: 409,
      body: {
        error: 'Capt. Travis has closed this trip and will be in touch with you directly. You can also call or text him at 352-586-7792.',
        code: 'departure-closed',
      },
    });
    assert.equal(store.get('b1')!.status, 'confirmed');
    assert.equal(await departureClosed(), true);
  });

  test('the page isn’t told for a trip that’s open, one with a closure offer, or one already cancelled', async (t) => {
    for (const [doc, others] of [
      [paid, {}],
      [{ ...paid, closure: { blackoutId: 'bo0', reason: 'Closed for weather', decideBy: '2099-07-07' } }, closedMorning],
      [{ ...paid, status: 'cancelled' }, closedMorning],
    ] as Array<[Doc, Parameters<typeof fakeDb>[1]]>) {
      const { db } = fakeDb({ b1: doc }, others);
      t.mock.method(liveDb, 'collection', db.collection);
      assert.equal(await departureClosed(), false, JSON.stringify(doc));
      t.mock.restoreAll();
    }
  });
});

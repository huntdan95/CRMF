/**
 * What stripeWebhook does with checkout.session.completed, against in-memory
 * stand-ins for Firestore and Stripe. Run with `npm test` in functions/.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type Stripe from 'stripe';

import {
  recordCompletedCheckout,
  type PaidAfterCancellation,
} from '../src/lib/checkout-completed';
import {
  buildBookingConfirmation,
  buildCancellationEmail,
  buildPaidAfterCancellationEmail,
  buildRescheduleAckEmail,
} from '../src/lib/email-templates';
import type { Booking } from '../src/lib/types';
import { TOKEN, fakeDb, type Doc } from './fakes';

const pending: Doc = {
  id: 'b1',
  tourName: 'Morning Manatee Tour',
  date: '2026-12-01',
  timeSlot: 'morning',
  guestCount: 4,
  customerName: 'Sam Rivera',
  customerEmail: 'sam@example.com',
  customerPhone: '555-0100',
  status: 'pending-payment',
  paymentStatus: 'pending',
  amountPaidCents: 0,
  amountRefundedCents: 0,
  accessToken: TOKEN,
  stripeCheckoutSessionId: 'cs_1',
};

const cancelled: Doc = {
  ...pending,
  status: 'cancelled',
  paymentStatus: 'failed',
  cancelledBy: 'admin',
  cancellationReason: 'Day closed by Capt. Travis',
};

function session(overrides: Partial<Stripe.Checkout.Session> = {}) {
  return {
    id: 'cs_1',
    metadata: { bookingId: 'b1' },
    payment_status: 'paid',
    amount_total: 24000,
    payment_intent: 'pi_1',
    livemode: false,
    ...overrides,
  } as Stripe.Checkout.Session;
}

/** Everything recordCompletedCheckout talks to, recording what it was asked. */
function harness(
  docs: Record<string, Doc>,
  opts: { refundFails?: boolean; alertFails?: boolean } = {},
) {
  const { db, store } = fakeDb(docs);
  const refunds: { params: Stripe.RefundCreateParams; options?: Stripe.RequestOptions }[] = [];
  const confirmations: string[] = [];
  const alerts: PaidAfterCancellation[] = [];
  const stripe = {
    refunds: {
      create: async (params: Stripe.RefundCreateParams, options?: Stripe.RequestOptions) => {
        refunds.push({ params, options });
        if (opts.refundFails) throw new Error('Stripe is down');
        return { id: 're_1', amount: 24000 };
      },
    },
  } as unknown as Pick<Stripe, 'refunds'>;
  const deps = {
    db,
    stripe,
    sendConfirmation: async (bookingId: string) => {
      confirmations.push(bookingId);
    },
    alertAdmin: async (alert: PaidAfterCancellation) => {
      if (opts.alertFails) throw new Error('Resend is down');
      alerts.push(alert);
    },
  };
  return { deps, store, refunds, confirmations, alerts };
}

describe('recordCompletedCheckout', () => {
  test('confirms a pending booking once it’s paid', async () => {
    const h = harness({ b1: pending });
    assert.equal(await recordCompletedCheckout(session(), h.deps), 'confirmed');
    const b = h.store.get('b1')!;
    assert.equal(b.status, 'confirmed');
    assert.equal(b.paymentStatus, 'paid');
    assert.equal(b.amountPaidCents, 24000);
    assert.equal(b.stripePaymentIntentId, 'pi_1');
    assert.deepEqual(h.confirmations, ['b1']);
    assert.deepEqual(h.refunds, []);
    assert.deepEqual(h.alerts, []);
  });

  test('keeps holding the seats while the payment clears', async () => {
    const h = harness({ b1: pending });
    const outcome = await recordCompletedCheckout(session({ payment_status: 'unpaid' }), h.deps);
    assert.equal(outcome, 'awaiting-payment');
    assert.equal(h.store.get('b1')!.status, 'pending-payment');
    assert.equal(h.store.get('b1')!.paymentStatus, 'pending');
    assert.equal(h.store.get('b1')!.amountPaidCents, 0, 'nothing paid yet');
    assert.deepEqual(h.confirmations, []);
  });

  test('confirms once a delayed payment clears', async () => {
    // checkout.session.completed (unpaid), then async_payment_succeeded.
    const h = harness({ b1: pending });
    await recordCompletedCheckout(session({ payment_status: 'unpaid' }), h.deps);
    assert.equal(await recordCompletedCheckout(session(), h.deps), 'confirmed');
    const b = h.store.get('b1')!;
    assert.equal(b.status, 'confirmed');
    assert.equal(b.paymentStatus, 'paid');
    assert.equal(b.amountPaidCents, 24000);
    assert.deepEqual(h.confirmations, ['b1']);
  });

  test('retries the confirmation email when Stripe redelivers', async () => {
    // The first delivery confirmed the booking but the email failed, so the
    // webhook returned 500. The sender itself skips if it already went out.
    const h = harness({ b1: { ...pending, status: 'confirmed', paymentStatus: 'paid', stripePaymentIntentId: 'pi_1' } });
    assert.equal(await recordCompletedCheckout(session(), h.deps), 'unchanged');
    assert.deepEqual(h.confirmations, ['b1']);
    assert.deepEqual(h.refunds, []);
  });

  test('refunds a payment on a cancelled booking instead of bringing it back', async () => {
    const h = harness({ b1: { ...cancelled, adminNotes: 'Regular, ask about the dog.' } });
    assert.equal(await recordCompletedCheckout(session(), h.deps), 'refunded');

    assert.equal(h.refunds.length, 1);
    assert.equal(h.refunds[0]!.params.payment_intent, 'pi_1');
    assert.equal(h.refunds[0]!.params.amount, undefined, 'refunds the whole charge');
    assert.equal(h.refunds[0]!.options?.idempotencyKey, 'paid-after-cancel-cs_1');

    const b = h.store.get('b1')!;
    assert.equal(b.status, 'cancelled');
    assert.equal(b.cancellationReason, 'Day closed by Capt. Travis');
    assert.equal(b.paymentStatus, 'refunded');
    assert.equal(b.amountPaidCents, 24000);
    assert.equal(b.amountRefundedCents, 24000);
    assert.equal(b.stripePaymentIntentId, 'pi_1');
    assert.match(String(b.adminNotes), /^Regular, ask about the dog\.\n\n/);
    assert.match(String(b.adminNotes), /Refunded automatically \(re_1\)/);

    assert.deepEqual(h.confirmations, [], 'no confirmation email');
    assert.equal(h.alerts.length, 1);
    assert.equal(h.alerts[0]!.outcome, 'refunded');
    assert.equal(h.alerts[0]!.refundId, 're_1');
    assert.equal(h.alerts[0]!.booking.status, 'cancelled');
  });

  test('asks the owner to refund by hand when the automatic refund fails', async () => {
    const h = harness({ b1: cancelled }, { refundFails: true });
    assert.equal(await recordCompletedCheckout(session(), h.deps), 'refund-failed');
    const b = h.store.get('b1')!;
    assert.equal(b.status, 'cancelled');
    assert.equal(b.paymentStatus, 'paid');
    assert.equal(b.amountPaidCents, 24000);
    assert.equal(b.amountRefundedCents, 0);
    assert.match(String(b.adminNotes), /automatic refund failed/);
    assert.equal(h.alerts[0]!.outcome, 'refund-failed');
    assert.equal(h.alerts[0]!.refundId, null);
  });

  test('alerts the owner about a cancelled booking whose payment hasn’t cleared', async () => {
    const h = harness({ b1: cancelled });
    const outcome = await recordCompletedCheckout(session({ payment_status: 'unpaid' }), h.deps);
    assert.equal(outcome, 'not-captured');
    assert.deepEqual(h.refunds, [], 'nothing to refund yet');
    const b = h.store.get('b1')!;
    assert.equal(b.status, 'cancelled');
    assert.equal(b.paymentStatus, 'pending');
    assert.equal(b.amountPaidCents, 0);
    assert.equal(b.stripePaymentIntentId, 'pi_1');
    assert.equal(h.alerts[0]!.outcome, 'not-captured');
  });

  test('still records the refund when the alert email fails', async () => {
    const h = harness({ b1: cancelled }, { alertFails: true });
    assert.equal(await recordCompletedCheckout(session(), h.deps), 'refunded');
    assert.equal(h.store.get('b1')!.paymentStatus, 'refunded');
  });

  test('does not refund a payment the booking already has', async () => {
    // Paid, then cancelled inside 24 hours (no refund). A replayed event
    // mustn't hand the money back.
    const h = harness({
      b1: { ...cancelled, paymentStatus: 'paid', amountPaidCents: 24000, stripePaymentIntentId: 'pi_1' },
    });
    assert.equal(await recordCompletedCheckout(session(), h.deps), 'unchanged');
    assert.deepEqual(h.refunds, []);
    assert.deepEqual(h.alerts, []);
    assert.equal(h.store.get('b1')!.paymentStatus, 'paid');
  });

  test('leaves bookings past checkout alone', async () => {
    for (const status of ['completed', 'no-show'] as const) {
      const h = harness({ b1: { ...pending, status, paymentStatus: 'paid', stripePaymentIntentId: 'pi_1' } });
      assert.equal(await recordCompletedCheckout(session(), h.deps), 'unchanged', status);
      assert.equal(h.store.get('b1')!.status, status);
      assert.deepEqual(h.confirmations, []);
      assert.deepEqual(h.refunds, []);
    }
  });

  test('ignores sessions with no booking', async () => {
    const h = harness({});
    assert.equal(await recordCompletedCheckout(session(), h.deps), 'not-found');
    assert.equal(await recordCompletedCheckout(session({ metadata: {} }), h.deps), 'not-found');
    assert.deepEqual(h.refunds, []);
    assert.deepEqual(h.alerts, []);
  });
});

describe('buildPaidAfterCancellationEmail', () => {
  const alert = (outcome: PaidAfterCancellation['outcome']): PaidAfterCancellation => ({
    booking: { ...cancelled, customerName: 'Sam <Rivera>' } as Booking,
    outcome,
    amountCents: 24000,
    paymentIntentId: 'pi_1',
    refundId: outcome === 'refunded' ? 're_1' : null,
    stripePaymentStatus: outcome === 'not-captured' ? 'unpaid' : 'paid',
    livemode: false,
  });

  test('tells the owner it was refunded', () => {
    const { subject, text } = buildPaidAfterCancellationEmail(alert('refunded'));
    assert.match(subject, /^Refunded:/);
    assert.match(text, /refunded in full automatically \(re_1\)/);
  });

  test('flags a refund the owner has to make', () => {
    for (const outcome of ['refund-failed', 'not-captured'] as const) {
      const { subject, text, html } = buildPaidAfterCancellationEmail(alert(outcome));
      assert.match(subject, /^Action needed:/, outcome);
      assert.match(text, /dashboard\.stripe\.com\/test\/payments\/pi_1/, outcome);
      assert.match(html, /Sam &lt;Rivera&gt;/, outcome);
    }
  });
});

describe('customer emails', () => {
  const booking = { ...pending, status: 'confirmed', tourId: 'morning-shared', guests: [{ name: 'Sam Rivera', age: null }] } as Booking;
  const marina = { name: "Pete's Pier Marina", address: '1 SW First Place' };

  test('the confirmation says when the boat leaves and when to arrive', () => {
    const { text, html } = buildBookingConfirmation({ booking, baseUrl: 'https://example.com', marina, phoneDisplay: '352-586-7792' });
    // 20 to 30 minutes before departure (owner, 2026-10-14).
    assert.match(text, /departs 8:00 AM \(please arrive 7:30–7:40 AM\)/);
    assert.match(html, /departs 8:00 AM \(please arrive 7:30–7:40 AM\)/);
  });

  test('the cancellation text keeps its blank lines', () => {
    const { text } = buildCancellationEmail({
      booking: { ...booking, amountPaidCents: 24000 } as Booking,
      refundCents: 24000,
      refundPercent: 100,
      cancelledBy: 'customer',
      marina,
      phoneDisplay: '352-586-7792',
    });
    assert.match(text, /\n\nOriginal booking:\n/);
    assert.doesNotMatch(text, /Reason:/, 'no reason line when none was given');
  });

  test('the reschedule acknowledgement goes to the customer in plain words', () => {
    const { subject, text } = buildRescheduleAckEmail({
      booking,
      requestedDate: '2026-12-05',
      requestedSlot: 'mid-morning',
      phoneDisplay: '352-586-7792',
      marina: { name: 'Marina', address: '1 Dock St' },
    });
    assert.match(subject, /move your tour/);
    assert.match(text, /Saturday, December 5, 2026, Mid-morning/);
    assert.match(text, /stays as it is until Travis confirms/);
  });
});

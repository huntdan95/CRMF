import type { Firestore } from 'firebase-admin/firestore';
import type Stripe from 'stripe';

import { db as defaultDb, FieldValue } from './firebase';
import { refundedTotalAfter } from './stripe';
import type { Booking } from './types';

export type PartialRefundOutcome =
  | {
      kind: 'refunded';
      refundCents: number;
      stripeRefundId: string;
      /** This request had already gone through; nothing new was refunded. */
      repeat: boolean;
    }
  | { kind: 'not-found' }
  /** Paid on the old website, or not paid at all. */
  | { kind: 'no-stripe-payment' }
  | { kind: 'too-much'; refundableCents: number }
  /**
   * Stripe already has a refund under this request's key, for a different
   * amount, or one still in progress. Nothing new was refunded.
   */
  | { kind: 'key-reused' };

/**
 * Travis refunding part of a booking's payment. The booking stays as it is.
 *
 * `requestId` is made once each time the refund window opens and sent with
 * every try, so a retry after a dropped connection can't refund twice:
 * Stripe gets it as the idempotency key, and the booking remembers it, so a
 * repeat that already went through just reports the first refund again.
 * A refund that reached Stripe but wasn't written to the booking is found
 * by its `requestId` and written then, before any check of what's left:
 * Stripe's webhook may have counted it on the booking since, so it would
 * look like too much (and after a day Stripe forgets the key).
 *
 * The refunded total written to the booking is Stripe's own: see
 * {@link refundedTotalAfter}.
 */
export async function adminPartialRefundOne(
  bookingId: string,
  opts: { amountCents: number; requestId: string; adminEmail: string },
  deps: { stripe: Pick<Stripe, 'refunds'>; db?: Firestore },
): Promise<PartialRefundOutcome> {
  const { stripe, db = defaultDb } = deps;
  const { amountCents, requestId } = opts;
  const ref = db.collection('bookings').doc(bookingId);

  const booking = (await ref.get()).data() as Booking | undefined;
  if (!booking) return { kind: 'not-found' };
  const done = booking.refundRequests?.[requestId];
  if (done) return { kind: 'refunded', ...done, repeat: true };
  if (!booking.stripePaymentIntentId) return { kind: 'no-stripe-payment' };

  const earlier = await findRequestRefund(stripe, booking.stripePaymentIntentId, requestId);
  // This request's refund, but not for this amount: as Stripe would answer.
  if (earlier && earlier.amount !== amountCents) return { kind: 'key-reused' };
  let refund: Stripe.Refund;
  if (earlier) {
    refund = earlier;
  } else {
    const refundableCents = Math.max(0, booking.amountPaidCents - (booking.amountRefundedCents ?? 0));
    if (amountCents > refundableCents) return { kind: 'too-much', refundableCents };

    try {
      refund = await stripe.refunds.create(
        {
          payment_intent: booking.stripePaymentIntentId,
          amount: amountCents,
          reason: 'requested_by_customer',
          metadata: {
            bookingId,
            refundType: 'partial',
            adminEmail: opts.adminEmail,
            requestId,
          },
          expand: ['charge'],
        },
        { idempotencyKey: `partial-${bookingId}-${requestId}` },
      );
    } catch (err) {
      if ((err as { type?: string }).type === 'StripeIdempotencyError') return { kind: 'key-reused' };
      throw err;
    }
  }

  return db.runTransaction(async (tx) => {
    const fresh = (await tx.get(ref)).data() as Booking;
    const recorded = fresh.refundRequests?.[requestId];
    if (recorded) return { kind: 'refunded' as const, ...recorded, repeat: true };

    const refundedTotal = refundedTotalAfter(fresh.amountRefundedCents ?? 0, refund);
    tx.update(ref, {
      amountRefundedCents: refundedTotal,
      paymentStatus: refundedTotal >= fresh.amountPaidCents ? 'refunded' : 'partial-refund',
      refundRequests: {
        ...fresh.refundRequests,
        [requestId]: { refundCents: amountCents, stripeRefundId: refund.id },
      },
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { kind: 'refunded' as const, refundCents: amountCents, stripeRefundId: refund.id, repeat: false };
  });
}

/** The refund an earlier try of this request got through Stripe, with its charge. */
async function findRequestRefund(
  stripe: Pick<Stripe, 'refunds'>,
  paymentIntentId: string,
  requestId: string,
): Promise<Stripe.Refund | null> {
  const { data } = await stripe.refunds.list({
    payment_intent: paymentIntentId,
    limit: 100,
    expand: ['data.charge'],
  });
  return data.find((r) => r.metadata?.requestId === requestId) ?? null;
}

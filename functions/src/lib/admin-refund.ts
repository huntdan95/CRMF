import type { Firestore } from 'firebase-admin/firestore';
import type Stripe from 'stripe';

import { db as defaultDb, FieldValue } from './firebase';
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
 *
 * The refunded total written to the booking is Stripe's own, read off the
 * refund's charge. stripeWebhook writes the same figure when Stripe reports
 * the refund, so it doesn't matter which lands first, and neither counts the
 * refund twice.
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

  const refundableCents = Math.max(0, booking.amountPaidCents - (booking.amountRefundedCents ?? 0));
  if (amountCents > refundableCents) return { kind: 'too-much', refundableCents };

  let refund: Stripe.Refund;
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
  const stripeRefundedTotal =
    refund.charge && typeof refund.charge === 'object' ? refund.charge.amount_refunded : null;

  return db.runTransaction(async (tx) => {
    const fresh = (await tx.get(ref)).data() as Booking;
    const recorded = fresh.refundRequests?.[requestId];
    if (recorded) return { kind: 'refunded' as const, ...recorded, repeat: true };

    const before = fresh.amountRefundedCents ?? 0;
    // Stripe's figure can trail ours only on a retried request, whose saved
    // response predates any refund made since; never lower the total.
    const refundedTotal =
      stripeRefundedTotal === null ? before + amountCents : Math.max(before, stripeRefundedTotal);
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

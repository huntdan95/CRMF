import { logger } from 'firebase-functions/v2';
import type { Firestore } from 'firebase-admin/firestore';
import type Stripe from 'stripe';
import { db as defaultDb, FieldValue } from './firebase';
import { marinaNow } from './datetime';
import { formatPrice } from './tours';
import type { Booking } from './types';

export type CompletedOutcome =
  /** Paid: the booking is confirmed and the customer emailed. */
  | 'confirmed'
  /** Checkout finished but the payment is still clearing. */
  | 'awaiting-payment'
  /** Paid for a booking that was already cancelled. Refunded, owner alerted. */
  | 'refunded'
  /** Same, but the refund failed. Owner alerted to refund it by hand. */
  | 'refund-failed'
  /** Checkout on a cancelled booking finished before the payment cleared. Owner alerted. */
  | 'not-captured'
  /** The booking is already past checkout, or already has this payment. Left alone. */
  | 'unchanged'
  /** No booking for this session. */
  | 'not-found';

/** What the owner is told when a payment lands on a cancelled booking. */
export interface PaidAfterCancellation {
  /** The booking as it was when the payment arrived. */
  booking: Booking;
  outcome: 'refunded' | 'refund-failed' | 'not-captured';
  amountCents: number;
  paymentIntentId: string | null;
  refundId: string | null;
  /** Stripe's payment_status for the session, e.g. `paid` or `unpaid`. */
  stripePaymentStatus: string;
  livemode: boolean;
}

/**
 * Records a finished Stripe Checkout on its booking.
 *
 * Only a `pending-payment` booking gets confirmed, and it's checked in the
 * same transaction that confirms it. A booking that's been cancelled
 * (by Travis, a blackout, or the customer) stays cancelled: the payment is
 * refunded in full and Travis gets an email to follow up with the customer.
 * A stray payment never turns back into a seat on the boat, because the seat
 * may have been resold and the trip may not be running.
 */
export async function recordCompletedCheckout(
  session: Stripe.Checkout.Session,
  deps: {
    stripe: Pick<Stripe, 'refunds'>;
    db?: Firestore;
    /** Emails the customer their booking confirmation. */
    sendConfirmation: (bookingId: string) => Promise<void>;
    /** Emails Travis about a payment on a cancelled booking. */
    alertAdmin: (alert: PaidAfterCancellation) => Promise<void>;
  },
): Promise<CompletedOutcome> {
  const { stripe, db = defaultDb } = deps;
  const bookingId = session.metadata?.bookingId;
  if (!bookingId) {
    logger.warn('checkout.session.completed without bookingId metadata', {
      sessionId: session.id,
    });
    return 'not-found';
  }

  const ref = db.collection('bookings').doc(bookingId);
  const paid = session.payment_status === 'paid';
  const amountCents = session.amount_total ?? 0;
  const paymentIntentId =
    typeof session.payment_intent === 'string'
      ? session.payment_intent
      : (session.payment_intent?.id ?? null);

  const found = await db.runTransaction(async (tx) => {
    const booking = (await tx.get(ref)).data() as Booking | undefined;
    if (booking?.status === 'pending-payment') {
      tx.update(ref, {
        status: paid ? 'confirmed' : 'pending-payment',
        paymentStatus: paid ? 'paid' : 'pending',
        // An unpaid session (a bank debit still clearing) hasn't paid anything
        // yet. async_payment_succeeded comes back through here once it has.
        amountPaidCents: paid ? amountCents : (booking.amountPaidCents ?? 0),
        stripePaymentIntentId: paymentIntentId,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    return booking;
  });

  if (!found) {
    logger.warn(`Booking ${bookingId} not found for completed session`, {
      sessionId: session.id,
    });
    return 'not-found';
  }
  if (found.status === 'pending-payment') {
    if (!paid) return 'awaiting-payment';
    await deps.sendConfirmation(bookingId);
    return 'confirmed';
  }
  const samePayment = !!paymentIntentId && found.stripePaymentIntentId === paymentIntentId;
  if (found.status === 'confirmed' && paid && samePayment) {
    // Stripe redelivering an event we already confirmed, most likely because
    // the confirmation email failed last time. sendConfirmation skips if it
    // already went out.
    await deps.sendConfirmation(bookingId);
    return 'unchanged';
  }
  if (found.status !== 'cancelled' || samePayment) {
    logger.info(`Booking ${bookingId} is ${found.status}; completed session ignored`, {
      sessionId: session.id,
    });
    return 'unchanged';
  }

  // -------------------------------------------------------------------------
  // Paid for a booking that's already cancelled.
  // -------------------------------------------------------------------------
  logger.error('Checkout completed on a cancelled booking', {
    bookingId,
    sessionId: session.id,
    paymentIntentId,
    paymentStatus: session.payment_status,
    amountCents,
    cancelledBy: found.cancelledBy,
    cancellationReason: found.cancellationReason,
  });

  let refund: Stripe.Refund | null = null;
  if (paid && paymentIntentId) {
    try {
      refund = await stripe.refunds.create(
        {
          payment_intent: paymentIntentId,
          metadata: { bookingId, cause: 'paid-after-cancellation' },
        },
        { idempotencyKey: `paid-after-cancel-${session.id}` },
      );
    } catch (err) {
      logger.error('Refund of payment on a cancelled booking failed', {
        bookingId,
        paymentIntentId,
        err,
      });
    }
  }
  const outcome = !paid ? 'not-captured' : refund ? 'refunded' : 'refund-failed';

  try {
    await db.runTransaction(async (tx) => {
      const fresh = (await tx.get(ref)).data() as Booking | undefined;
      if (!fresh) return;
      const note = paidAfterCancellationNote(outcome, amountCents, refund?.id);
      tx.update(ref, {
        amountPaidCents: paid ? amountCents : fresh.amountPaidCents,
        amountRefundedCents: (fresh.amountRefundedCents ?? 0) + (refund?.amount ?? 0),
        paymentStatus: outcome === 'refunded' ? 'refunded' : paid ? 'paid' : 'pending',
        stripePaymentIntentId: paymentIntentId,
        adminNotes: fresh.adminNotes ? `${fresh.adminNotes}\n\n${note}` : note,
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
  } catch (err) {
    logger.error('Could not record payment on cancelled booking', { bookingId, err });
  }

  try {
    await deps.alertAdmin({
      booking: found,
      outcome,
      amountCents,
      paymentIntentId,
      refundId: refund?.id ?? null,
      stripePaymentStatus: session.payment_status,
      livemode: session.livemode,
    });
  } catch (err) {
    logger.error('Could not email admin about payment on cancelled booking', {
      bookingId,
      err,
    });
  }

  return outcome;
}

function paidAfterCancellationNote(
  outcome: PaidAfterCancellation['outcome'],
  amountCents: number,
  refundId: string | undefined,
): string {
  const today = marinaNow().date;
  switch (outcome) {
    case 'refunded':
      return `${today}: Paid ${formatPrice(amountCents)} after this booking was cancelled. Refunded automatically (${refundId}).`;
    case 'refund-failed':
      return `${today}: Paid ${formatPrice(amountCents)} after this booking was cancelled. The automatic refund failed. Refund it in Stripe.`;
    case 'not-captured':
      return `${today}: Finished Stripe checkout after this booking was cancelled; the payment hadn't cleared yet. Refund it in Stripe once it does.`;
  }
}

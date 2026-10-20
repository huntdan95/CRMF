import { logger } from 'firebase-functions/v2';
import type { Firestore } from 'firebase-admin/firestore';
import type Stripe from 'stripe';
import { db as defaultDb, FieldValue } from './firebase';
import { departureClosed, marinaNow, zonedTimeToUtc } from './datetime';
import { SLOT_MINUTES, slotStartTime } from './schedule';
import { formatPrice } from './tours';
import { ADMIN_EMAIL, APP_BASE_URL } from './config';
import { isEmailSendError, sendEmail, type EmailDeps } from './email-log';
import { buildLastMinuteBookingEmail } from './email-templates';
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
 * A booking paid for inside the online cutoff, or after its trip left.
 * Online booking closes an hour before each departure
 * (ONLINE_CUTOFF_MINUTES), but a checkout started before then can still be
 * paid after it, while Travis is getting the boat ready.
 */
export interface LastMinuteBooking {
  booking: Booking;
  /** When Stripe says the checkout finished. */
  paidAt: Date;
  /** The departure, `HH:MM` marina time (the sunset cruise's on that day). */
  departs: string;
  /** Minutes from `paidAt` to the departure; 0 or less once it had left. */
  minutesToGo: number;
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
    /**
     * Emails Travis about a booking paid inside the online cutoff
     * ({@link sendLastMinuteAlert}). Runs after the confirmation; a failure
     * is logged and nothing else.
     */
    alertLastMinute?: (alert: LastMinuteBooking) => Promise<void>;
    /**
     * When the checkout finished: the Stripe event's `created`, so a retried
     * delivery judges the booking by when it was paid. Defaults to now.
     */
    paidAt?: Date;
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
    await confirmAndAlert(bookingId, found, deps);
    return 'confirmed';
  }
  const samePayment = !!paymentIntentId && found.stripePaymentIntentId === paymentIntentId;
  if (found.status === 'confirmed' && paid && samePayment) {
    // Stripe redelivering an event we already confirmed, most likely because
    // the confirmation email failed last time. sendConfirmation skips if it
    // already went out, and so does the alert (its idempotency key).
    await confirmAndAlert(bookingId, found, deps);
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

/**
 * Emails the customer their confirmation, then tells Travis if the trip
 * leaves within the online cutoff. The alert waits for the confirmation and
 * can't fail it, but it goes out even when the confirmation email fails:
 * that error still goes back to Stripe for a retry, and Travis hears about
 * a trip leaving in half an hour now, not at Stripe's next try.
 */
async function confirmAndAlert(
  bookingId: string,
  booking: Booking,
  deps: {
    sendConfirmation: (bookingId: string) => Promise<void>;
    alertLastMinute?: (alert: LastMinuteBooking) => Promise<void>;
    paidAt?: Date;
  },
): Promise<void> {
  try {
    await deps.sendConfirmation(bookingId);
  } finally {
    const { alertLastMinute, paidAt = new Date() } = deps;
    const soon = departingSoon(booking, paidAt);
    if (alertLastMinute && soon) {
      try {
        await alertLastMinute({ booking: { ...booking, id: bookingId }, paidAt, ...soon });
      } catch (err) {
        logger.error('Could not email admin about a last-minute booking', { bookingId, err });
      }
    }
  }
}

/**
 * The departure of a trip that leaves within the online cutoff at `at`, or
 * has already left, with the minutes to go; null when it's further off.
 * The same line the booking window draws ({@link departureClosed}), in
 * marina time, the sunset cruise at that day's time. Used for Travis's
 * last-minute alert and the crew's booking notification.
 */
export function departingSoon(
  booking: Pick<Booking, 'date' | 'timeSlot'>,
  at: Date = new Date(),
): { departs: string; minutesToGo: number } | null {
  if (!(booking.timeSlot in SLOT_MINUTES)) return null;
  const departs = slotStartTime(booking.timeSlot, booking.date);
  if (!departureClosed(booking.date, departs, marinaNow(at))) return null;
  // Rounded up, it's the gap between the clock times shown: paid at
  // 7:29:40 for 8:00 is 31 minutes.
  const ms = zonedTimeToUtc(booking.date, departs).getTime() - at.getTime();
  return { departs, minutesToGo: Math.ceil(ms / 60_000) };
}

/** "Leaves in 25 min", for the crew's notification. */
export function leavesIn(minutesToGo: number): string {
  if (minutesToGo > 0) return `Leaves in ${minutesToGo} min`;
  return minutesToGo === 0 ? 'Leaving now' : 'Already left';
}

/**
 * Emails Travis about a booking paid inside the online cutoff (kind
 * `admin`; replies go to the customer). Keyed on the booking, so a webhook
 * retry gets Resend's first answer instead of a second email. Throws when
 * Resend refuses it.
 */
export async function sendLastMinuteAlert(
  alert: LastMinuteBooking,
  deps: EmailDeps & { baseUrl?: string; adminEmail?: string } = {},
): Promise<void> {
  const { subject, html, text } = buildLastMinuteBookingEmail(
    alert,
    deps.baseUrl ?? APP_BASE_URL.value(),
  );
  try {
    await sendEmail(
      {
        kind: 'admin',
        bookingId: alert.booking.id,
        to: deps.adminEmail ?? ADMIN_EMAIL.value(),
        subject,
        html,
        text,
        replyTo: alert.booking.customerEmail,
        headers: { 'X-Entity-Ref-ID': alert.booking.id },
        idempotencyKey: `last-minute-booking/${alert.booking.id}`,
      },
      deps,
    );
  } catch (err) {
    // Same key, different email (the booking was edited between tries):
    // the alert already went out.
    if (isEmailSendError(err, 'invalid_idempotent_request')) return;
    throw err;
  }
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

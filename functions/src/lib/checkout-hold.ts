import type { Firestore } from 'firebase-admin/firestore';
import type Stripe from 'stripe';
import { db as defaultDb, FieldValue } from './firebase';
import type { Booking } from './types';

/** The `{bookingId, accessToken}` createCheckoutSession hands the browser. */
export interface CheckoutHold {
  bookingId: string;
  accessToken: string;
}

export type ReleaseOutcome =
  /** Stripe session expired and the booking cancelled: the seats are free. */
  | 'released'
  /** The booking isn't holding seats for a checkout (already cancelled, paid, …). */
  | 'not-held'
  /** The customer finished Stripe Checkout. The webhook owns it from here. */
  | 'checkout-complete'
  /** No Stripe session on the booking yet, so it can't be safely released. */
  | 'no-session'
  /** No booking with that id and token. */
  | 'not-found';

/**
 * Lets go of a customer's unpaid checkout right away, instead of holding the
 * seats until Stripe expires the session 30 minutes later. Used when they
 * come back from Stripe without paying, and when they start a new checkout.
 *
 * Stripe goes first: the Checkout session is expired before the booking is
 * touched. An expired session can't be paid, so stripeWebhook can never flip
 * the cancelled booking back to confirmed. If the session already completed,
 * the booking is left alone.
 */
export async function releaseHold(
  hold: CheckoutHold,
  deps: {
    stripe: Pick<Stripe, 'checkout'>;
    db?: Firestore;
  },
  opts: {
    /** Recorded as the booking's cancellationReason. */
    reason?: string;
  } = {},
): Promise<ReleaseOutcome> {
  const { stripe, db = defaultDb } = deps;
  const ref = db.collection('bookings').doc(hold.bookingId);

  const snap = await ref.get();
  const booking = snap.data() as Booking | undefined;
  if (!booking || booking.accessToken !== hold.accessToken) return 'not-found';
  if (booking.status !== 'pending-payment') return 'not-held';

  const sessionId = booking.stripeCheckoutSessionId;
  if (!sessionId) return 'no-session';

  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.expire(sessionId);
  } catch (err) {
    // Stripe only expires open sessions. Find out why this one wasn't.
    session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.status === 'open') throw err;
  }
  if (session.status === 'complete') return 'checkout-complete';

  return db.runTransaction<ReleaseOutcome>(async (tx) => {
    const fresh = (await tx.get(ref)).data() as Booking | undefined;
    if (
      fresh?.status !== 'pending-payment' ||
      fresh.stripeCheckoutSessionId !== sessionId
    ) {
      return 'not-held';
    }
    tx.update(ref, {
      status: 'cancelled',
      paymentStatus: 'failed',
      cancellationReason: opts.reason ?? 'Left checkout without paying',
      cancelledAt: FieldValue.serverTimestamp(),
      cancelledBy: 'customer',
      updatedAt: FieldValue.serverTimestamp(),
    });
    return 'released';
  });
}

import { onRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import type { Firestore } from 'firebase-admin/firestore';
import type Stripe from 'stripe';
import { z } from 'zod';

import { db, FieldValue } from './lib/firebase';
import {
  releaseHold,
  type CheckoutHold,
  type ReleaseOutcome,
} from './lib/checkout-hold';
import {
  STRIPE_SECRET_KEY,
  getStripe,
} from './lib/stripe';
import {
  RESEND_API_KEY,
  RESEND_FROM_EMAIL,
  getResend,
  getFromAddress,
} from './lib/resend';
import { APP_BASE_URL, ADMIN_EMAIL } from './lib/config';
import { getTourBySlug } from './lib/tours';
import { quoteCustomerRefund } from './lib/datetime';
import { buildCancellationEmail } from './lib/email-templates';
import {
  applyCors,
  badRequest,
  methodNotAllowed,
  serverError,
} from './lib/http';
import { isLegacyBooking, type Booking } from './lib/types';
import { marinaNow } from './lib/datetime';

const MARINA = {
  name: "Pete's Pier Marina",
  address: '1 SW First Place, Crystal River, FL 34429',
};
const PHONE_DISPLAY = '352-586-7792';

const requestSchema = z.object({
  bookingId: z.string().min(1).max(64),
  accessToken: z.string().min(8).max(64),
  reason: z.string().trim().max(500).optional(),
});

/**
 * POST /cancelBooking
 *
 * Customer self-service cancellation. Token-authenticated. Applies the
 * v1 policy (72h = full, 24-72h = 50%, < 24h = no refund) and processes
 * any owed refund via Stripe.
 *
 * The Stripe call uses a deterministic idempotency key so retrying after a
 * partial failure never double-refunds. The Firestore status update happens
 * AFTER Stripe so an external failure leaves the booking unchanged.
 *
 * A booking that hasn't been paid for yet goes through
 * {@link cancelUnpaidBooking} instead.
 */
export const cancelBooking = onRequest(
  {
    cors: false,
    secrets: [
      STRIPE_SECRET_KEY,
      RESEND_API_KEY,
      RESEND_FROM_EMAIL,
      APP_BASE_URL,
    ],
    maxInstances: 10,
  },
  async (req, res) => {
    if (applyCors(req, res)) return;
    if (req.method !== 'POST') {
      methodNotAllowed(res, ['POST']);
      return;
    }

    const parsed = requestSchema.safeParse(req.body);
    if (!parsed.success) {
      badRequest(res, 'Invalid input', parsed.error.format());
      return;
    }
    const { bookingId, accessToken, reason } = parsed.data;

    const ref = db.collection('bookings').doc(bookingId);
    const snap = await ref.get();
    if (!snap.exists) {
      res.status(404).json({ error: 'Booking not found' });
      return;
    }

    const booking = snap.data() as Booking;
    if (booking.accessToken !== accessToken) {
      res.status(403).json({ error: 'Invalid access token' });
      return;
    }

    if (booking.status === 'cancelled') {
      res.status(200).json(alreadyCancelled(booking));
      return;
    }
    if (booking.status === 'completed' || booking.status === 'no-show') {
      res.status(409).json({
        error: 'Tours that have already happened can\'t be cancelled.',
      });
      return;
    }
    // Still "confirmed" because Travis hasn't marked it yet, but the day has
    // been: cancelling now would only drop it from his records and stats.
    if (booking.date < marinaNow().date) {
      res.status(409).json({
        error: 'Tours that have already happened can\'t be cancelled.',
      });
      return;
    }

    // Booked on the old website: the money isn't in this site's Stripe, so a
    // refund can't be worked out or sent from here. Travis handles these.
    if (isLegacyBooking({ id: bookingId, legacy: booking.legacy })) {
      res.status(409).json({
        error: `This booking was made on our old website, so it can't be cancelled online. Please call or text Travis at ${PHONE_DISPLAY} and he'll sort it out.`,
      });
      return;
    }

    // Not paid for yet: the Stripe Checkout session may still be open.
    // No cancellation email, since they were never charged or confirmed.
    if (booking.status === 'pending-payment') {
      try {
        const result = await cancelUnpaidBooking(
          { bookingId, accessToken },
          reason,
          { stripe: getStripe() },
        );
        logger.info('Cancelled unpaid booking', {
          bookingId,
          outcome: result.outcome,
        });
        res.status(result.status).json(result.body);
      } catch (err) {
        logger.error('Could not cancel unpaid booking', { bookingId, err });
        serverError(res, err);
      }
      return;
    }

    // -----------------------------------------------------------------------
    // Compute the refund quote.
    // -----------------------------------------------------------------------
    const tour = await getTourBySlug(booking.tourId);
    if (!tour) {
      logger.error(`Tour ${booking.tourId} missing for booking ${bookingId}`);
      res.status(500).json({ error: 'Tour record missing — call Travis.' });
      return;
    }

    const quote = quoteCustomerRefund({
      amountPaidCents: booking.amountPaidCents,
      date: booking.date,
      startTime: tour.startTime,
    });

    // -----------------------------------------------------------------------
    // Issue the Stripe refund (if any) BEFORE marking the booking cancelled.
    // Idempotency key prevents double-refunds on retry.
    // -----------------------------------------------------------------------
    let refundId: string | null = null;
    if (
      quote.refundCents > 0 &&
      booking.stripePaymentIntentId &&
      booking.amountPaidCents > 0
    ) {
      try {
        const stripe = getStripe();
        const refund = await stripe.refunds.create(
          {
            payment_intent: booking.stripePaymentIntentId,
            amount: quote.refundCents,
            reason: 'requested_by_customer',
            metadata: {
              bookingId,
              cancelledBy: 'customer',
              policyTier: quote.tier,
            },
          },
          {
            idempotencyKey: `cancel-${bookingId}`,
          },
        );
        refundId = refund.id;
      } catch (err) {
        logger.error('Stripe refund failed', { bookingId, err });
        serverError(res, err);
        return;
      }
    }

    // -----------------------------------------------------------------------
    // Mark the booking cancelled. Use a transaction so concurrent admin
    // edits don't trample.
    // -----------------------------------------------------------------------
    try {
      await db.runTransaction(async (tx) => {
        const fresh = await tx.get(ref);
        const current = fresh.data() as Booking;
        if (current.status === 'cancelled') return; // raced
        tx.update(ref, {
          status: 'cancelled',
          paymentStatus:
            quote.refundCents === 0
              ? current.paymentStatus
              : quote.refundCents === current.amountPaidCents
                ? 'refunded'
                : 'partial-refund',
          amountRefundedCents:
            (current.amountRefundedCents ?? 0) + quote.refundCents,
          cancellationReason: reason ?? null,
          cancelledAt: FieldValue.serverTimestamp(),
          cancelledBy: 'customer',
          updatedAt: FieldValue.serverTimestamp(),
        });
      });
    } catch (err) {
      logger.error('Firestore cancellation write failed', {
        bookingId,
        refundId,
        err,
      });
      serverError(res, err);
      return;
    }

    // -----------------------------------------------------------------------
    // Email customer (+ BCC admin). Failure here doesn't unwind the
    // cancellation; we log and continue.
    // -----------------------------------------------------------------------
    try {
      const refreshed = (await ref.get()).data() as Booking;
      const resend = getResend();
      const from = getFromAddress();
      const adminEmail = ADMIN_EMAIL.value();

      const { subject, html, text } = buildCancellationEmail({
        booking: refreshed,
        refundCents: quote.refundCents,
        refundPercent: quote.refundPercent,
        cancelledBy: 'customer',
        reason,
        marina: MARINA,
        phoneDisplay: PHONE_DISPLAY,
      });

      await resend.emails.send({
        from,
        to: [refreshed.customerEmail],
        bcc: [adminEmail],
        subject,
        html,
        text,
        replyTo: adminEmail,
        headers: { 'X-Entity-Ref-ID': bookingId },
      });
    } catch (err) {
      logger.error('Cancellation email failed', { bookingId, err });
    }

    res.status(200).json({
      ok: true,
      refundCents: quote.refundCents,
      refundPercent: quote.refundPercent,
      policyTier: quote.tier,
      stripeRefundId: refundId,
    });
  },
);

const PAYMENT_WENT_THROUGH =
  'Your payment just went through, so this booking is paid for now. ' +
  'Reload the page to see what you\'d get back, then cancel from there.';

function alreadyCancelled(booking: Booking) {
  return {
    alreadyCancelled: true,
    booking: {
      id: booking.id,
      status: booking.status,
      amountRefundedCents: booking.amountRefundedCents,
    },
  };
}

/**
 * Cancels a booking the customer hasn't paid for. Its Stripe Checkout
 * session may still be open in another tab, so this goes through
 * releaseHold: the session is expired first, and the booking cancelled only
 * once Stripe says it can't be paid. Otherwise the customer could still pay
 * and stripeWebhook would find a paid booking that's been cancelled.
 *
 * If the payment beat us to it, nothing is cancelled. Their refund depends on
 * the policy, so they reload and see it before cancelling.
 */
export async function cancelUnpaidBooking(
  hold: CheckoutHold,
  reason: string | undefined,
  deps: {
    stripe: Pick<Stripe, 'checkout'>;
    db?: Firestore;
  },
): Promise<{
  outcome: ReleaseOutcome;
  status: number;
  body: Record<string, unknown>;
}> {
  const outcome = await releaseHold(hold, deps, {
    reason: reason ?? 'Cancelled before paying',
  });
  switch (outcome) {
    case 'released':
      return {
        outcome,
        status: 200,
        body: { ok: true, unpaid: true, refundCents: 0, refundPercent: 0, stripeRefundId: null },
      };
    case 'checkout-complete':
      return { outcome, status: 409, body: { error: PAYMENT_WENT_THROUGH } };
    case 'no-session':
      return {
        outcome,
        status: 409,
        body: { error: 'Your checkout is still being set up. Try again in a minute.' },
      };
    case 'not-found':
      return { outcome, status: 404, body: { error: 'Booking not found' } };
    case 'not-held': {
      // It changed after we looked: cancelled by the expiry webhook, or paid.
      const fresh = (
        await (deps.db ?? db).collection('bookings').doc(hold.bookingId).get()
      ).data() as Booking | undefined;
      if (fresh?.status === 'cancelled') {
        return { outcome, status: 200, body: alreadyCancelled(fresh) };
      }
      return { outcome, status: 409, body: { error: PAYMENT_WENT_THROUGH } };
    }
  }
}

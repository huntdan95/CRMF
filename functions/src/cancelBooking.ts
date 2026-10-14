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
  refundedTotalAfter,
} from './lib/stripe';
import {
  RESEND_API_KEY,
  RESEND_FROM_EMAIL,
  getResend,
  getFromAddress,
} from './lib/resend';
import { APP_BASE_URL, ADMIN_EMAIL } from './lib/config';
import { getTourBySlug } from './lib/tours';
import { quoteCustomerRefund, type RefundQuote } from './lib/datetime';
import { buildCancellationEmail } from './lib/email-templates';
import type { CancellationMailer } from './lib/admin-cancel';
import {
  applyCors,
  badRequest,
  methodNotAllowed,
  serverError,
} from './lib/http';
import { isLegacyBooking, type Booking } from './lib/types';
import { hoursUntilTour, marinaNow } from './lib/datetime';
import { SLOT_START_TIMES } from './lib/schedule';
import { alertCrewOfCancellation } from './crewAlerts';

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
 * any owed refund via Stripe: see {@link cancelPaidBooking}.
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
    // Still "confirmed" because Travis hasn't marked it yet, but the boat
    // has left: cancelling now would only drop it from his records, the
    // manifest and the stats.
    const departs = SLOT_START_TIMES[booking.timeSlot];
    if (
      booking.date < marinaNow().date ||
      (departs !== undefined && hoursUntilTour(booking.date, departs) < 0)
    ) {
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

    const tour = await getTourBySlug(booking.tourId);
    if (!tour) {
      logger.error(`Tour ${booking.tourId} missing for booking ${bookingId}`);
      res.status(500).json({ error: 'Tour record missing — call Travis.' });
      return;
    }

    let result: Awaited<ReturnType<typeof cancelPaidBooking>>;
    try {
      result = await cancelPaidBooking(
        bookingId,
        booking,
        { reason, startTime: tour.startTime },
        { stripe: getStripe(), mailer: customerMailer() },
      );
    } catch (err) {
      serverError(res, err);
      return;
    }

    // Tell the crew. Never undoes the cancellation; retryCrewAlerts picks
    // up a failed send.
    try {
      const alert = await alertCrewOfCancellation(bookingId);
      logger.info('Crew cancellation alert', { bookingId, alert });
    } catch (err) {
      logger.error('Crew cancellation alert failed', { bookingId, err });
    }

    res.status(200).json({
      ok: true,
      refundCents: result.quote.refundCents,
      refundPercent: result.quote.refundPercent,
      policyTier: result.quote.tier,
      stripeRefundId: result.refundId,
    });
  },
);

/** Emails go out from the site, copied to Travis, replies to him. */
function customerMailer(): CancellationMailer {
  return {
    marina: MARINA,
    phoneDisplay: PHONE_DISPLAY,
    async send({ to, subject, html, text, bookingId }) {
      const adminEmail = ADMIN_EMAIL.value();
      await getResend().emails.send({
        from: getFromAddress(),
        to: [to],
        bcc: [adminEmail],
        subject,
        html,
        text,
        replyTo: adminEmail,
        headers: { 'X-Entity-Ref-ID': bookingId },
      });
    },
  };
}

/**
 * Cancels a paid booking under the refund policy. The policy percentage
 * applies to what's left of the payment after any refund Travis already
 * gave, so Stripe is never asked for more than remains.
 *
 * The Stripe refund goes first, under a key that's the same on every retry
 * so it never refunds twice. The booking is marked cancelled only after
 * Stripe has taken the refund, so a Stripe failure leaves it unchanged. An
 * email failure doesn't undo the cancellation.
 *
 * If an earlier try got the refund through but then failed to mark the
 * booking cancelled, a retry settles on that refund instead of quoting
 * again. The tour may have come within 72 or 24 hours since, and Stripe
 * refuses a new amount under the same key every time (or, once it forgets
 * the key a day later, refunds it on top of the first).
 */
export async function cancelPaidBooking(
  bookingId: string,
  booking: Booking,
  opts: {
    reason: string | undefined;
    /** The tour's `HH:MM` start time. */
    startTime: string;
    now?: Date;
  },
  deps: {
    stripe: Pick<Stripe, 'refunds'>;
    mailer: CancellationMailer;
    db?: Firestore;
  },
): Promise<{ quote: CustomerRefund; refundId: string | null }> {
  const ref = (deps.db ?? db).collection('bookings').doc(bookingId);
  const paymentIntentId = booking.stripePaymentIntentId;

  let refund = paymentIntentId
    ? await findCancelRefund(deps.stripe, paymentIntentId, bookingId)
    : null;
  let quote: CustomerRefund;
  let earlierRefundCents: number;
  if (refund) {
    const tier = refund.metadata?.policyTier === 'half' ? 'half' : 'full';
    quote = { tier, refundPercent: tier === 'half' ? 50 : 100, refundCents: refund.amount };
    // What had been refunded before this one. The booking may count this
    // one already, if Stripe's webhook got to it.
    earlierRefundCents =
      refund.charge && typeof refund.charge === 'object'
        ? Math.max(0, refund.charge.amount_refunded - refund.amount)
        : (booking.amountRefundedCents ?? 0);
  } else {
    earlierRefundCents = booking.amountRefundedCents ?? 0;
    quote = quoteCustomerRefund({
      amountPaidCents: booking.amountPaidCents,
      amountRefundedCents: earlierRefundCents,
      date: booking.date,
      startTime: opts.startTime,
      now: opts.now,
    });
    if (quote.refundCents > 0 && paymentIntentId) {
      try {
        refund = await deps.stripe.refunds.create(
          {
            payment_intent: paymentIntentId,
            amount: quote.refundCents,
            reason: 'requested_by_customer',
            metadata: {
              bookingId,
              cancelledBy: 'customer',
              policyTier: quote.tier,
            },
            expand: ['charge'],
          },
          {
            idempotencyKey: `cancel-${bookingId}`,
          },
        );
      } catch (err) {
        logger.error('Stripe refund failed', { bookingId, err });
        throw err;
      }
    }
  }
  const refundId = refund?.id ?? null;

  // A transaction, so a concurrent admin edit or refund isn't trampled.
  try {
    await (deps.db ?? db).runTransaction(async (tx) => {
      const current = (await tx.get(ref)).data() as Booking;
      if (current.status === 'cancelled') return; // raced
      const before = current.amountRefundedCents ?? 0;
      // Stripe's total, so a charge.refunded webhook landing first doesn't
      // count the refund twice.
      const refundedTotal = refund
        ? refundedTotalAfter(before, refund)
        : before + quote.refundCents;
      tx.update(ref, {
        status: 'cancelled',
        paymentStatus:
          quote.refundCents === 0
            ? current.paymentStatus
            : refundedTotal >= current.amountPaidCents
              ? 'refunded'
              : 'partial-refund',
        amountRefundedCents: refundedTotal,
        cancellationReason: opts.reason ?? null,
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
    throw err;
  }

  try {
    const refreshed = (await ref.get()).data() as Booking;
    const { subject, html, text } = buildCancellationEmail({
      booking: refreshed,
      refundCents: quote.refundCents,
      refundPercent: quote.refundPercent,
      cancelledBy: 'customer',
      reason: opts.reason,
      marina: deps.mailer.marina,
      phoneDisplay: deps.mailer.phoneDisplay,
      previouslyRefundedCents: earlierRefundCents,
    });
    await deps.mailer.send({ to: refreshed.customerEmail, subject, html, text, bookingId });
  } catch (err) {
    logger.error('Cancellation email failed', { bookingId, err });
  }

  return { quote, refundId };
}

/** What the customer gets back, and under which part of the policy. */
type CustomerRefund = Pick<RefundQuote, 'tier' | 'refundCents' | 'refundPercent'>;

/** The refund an earlier try at cancelling this booking got through Stripe. */
async function findCancelRefund(
  stripe: Pick<Stripe, 'refunds'>,
  paymentIntentId: string,
  bookingId: string,
): Promise<Stripe.Refund | null> {
  const { data } = await stripe.refunds.list({
    payment_intent: paymentIntentId,
    limit: 100,
    expand: ['data.charge'],
  });
  return (
    data.find(
      (r) => r.metadata?.bookingId === bookingId && r.metadata?.cancelledBy === 'customer',
    ) ?? null
  );
}

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

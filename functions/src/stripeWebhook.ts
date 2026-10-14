import { onRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import type Stripe from 'stripe';

import { db, FieldValue } from './lib/firebase';
import {
  STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET,
  getStripe,
} from './lib/stripe';
import {
  RESEND_API_KEY,
  RESEND_FROM_EMAIL,
  getResend,
  getFromAddress,
} from './lib/resend';
import { APP_BASE_URL, ADMIN_EMAIL } from './lib/config';
import { sendBookingConfirmation } from './lib/send-confirmation';
import {
  recordCompletedCheckout,
  type PaidAfterCancellation,
} from './lib/checkout-completed';
import { buildPaidAfterCancellationEmail } from './lib/email-templates';

/**
 * Stripe webhook endpoint.
 *
 * Configure in the Stripe dashboard with the deployed URL:
 *   https://<region>-<project>.cloudfunctions.net/stripeWebhook
 * Events to subscribe:
 *   - checkout.session.completed   (booking confirmed, or refunded if it was cancelled)
 *   - checkout.session.async_payment_succeeded  (a delayed payment cleared: confirm)
 *   - checkout.session.async_payment_failed     (a delayed payment bounced: release)
 *   - checkout.session.expired     (release the hold)
 *   - payment_intent.payment_failed
 *   - charge.refunded              (sync refunds we issue from admin)
 *
 * Idempotent: every event id is claimed in `stripeWebhookEvents/{event.id}`
 * and marked done once handled; duplicate deliveries short-circuit. If a
 * handler fails, the claim is released and Stripe gets a 500, so it retries
 * (with backoff, for up to three days). The handlers are safe to re-run.
 */
export const stripeWebhook = onRequest(
  {
    cors: false,
    // rawBody is required for signature verification.
    secrets: [
      STRIPE_SECRET_KEY,
      STRIPE_WEBHOOK_SECRET,
      RESEND_API_KEY,
      RESEND_FROM_EMAIL,
      APP_BASE_URL,
    ],
    maxInstances: 10,
    invoker: 'public',
  },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).send('Method not allowed');
      return;
    }
    const sig = req.headers['stripe-signature'];
    const webhookSecret = STRIPE_WEBHOOK_SECRET.value();
    if (!sig || !webhookSecret) {
      res.status(400).send('Missing signature or webhook secret');
      return;
    }

    const stripe = getStripe();
    let event: Stripe.Event;
    try {
      // `req.rawBody` is populated by firebase-functions for HTTP triggers.
      event = stripe.webhooks.constructEvent(req.rawBody, sig, webhookSecret);
    } catch (err) {
      logger.warn('Stripe signature verification failed', { err });
      res.status(400).send(
        `Webhook signature verification failed: ${err instanceof Error ? err.message : 'unknown'}`,
      );
      return;
    }

    // Idempotency: claim the event id in a transaction, so two deliveries
    // of the same event can't both run.
    const eventRef = db.collection('stripeWebhookEvents').doc(event.id);
    const claim = await db.runTransaction(async (tx) => {
      const prior = (await tx.get(eventRef)).data();
      if (prior) {
        // Records from before claims had a status were all handled.
        if (prior.status !== 'processing') return 'duplicate' as const;
        const claimedAtMs = typeof prior.claimedAtMs === 'number' ? prior.claimedAtMs : 0;
        // Another delivery is working on it. Past a few minutes it must have
        // crashed, so take over.
        if (Date.now() - claimedAtMs < 5 * 60_000) return 'in-flight' as const;
      }
      tx.set(eventRef, {
        id: event.id,
        type: event.type,
        status: 'processing',
        claimedAtMs: Date.now(),
        receivedAt: FieldValue.serverTimestamp(),
      });
      return 'claimed' as const;
    });
    if (claim === 'duplicate') {
      logger.info(`Duplicate webhook ${event.id} (${event.type}) — ignoring`);
      res.status(200).json({ received: true, duplicate: true });
      return;
    }
    if (claim === 'in-flight') {
      // Not 2xx, so Stripe tries again later and finds it done.
      logger.info(`Webhook ${event.id} (${event.type}) already being handled`);
      res.status(409).json({ received: true, inFlight: true });
      return;
    }

    try {
      switch (event.type) {
        case 'checkout.session.completed':
        case 'checkout.session.async_payment_succeeded': {
          const session = event.data.object as Stripe.Checkout.Session;
          const outcome = await recordCompletedCheckout(session, {
            stripe,
            sendConfirmation: sendBookingConfirmation,
            alertAdmin: emailPaidAfterCancellation,
          });
          logger.info(event.type, {
            sessionId: session.id,
            bookingId: session.metadata?.bookingId,
            outcome,
          });
          break;
        }
        case 'checkout.session.expired':
          await releaseUnpaidBooking(
            event.data.object as Stripe.Checkout.Session,
            'Checkout session expired',
          );
          break;
        case 'checkout.session.async_payment_failed':
          await releaseUnpaidBooking(
            event.data.object as Stripe.Checkout.Session,
            'Bank payment failed',
          );
          break;
        case 'payment_intent.payment_failed':
          await handlePaymentFailed(
            event.data.object as Stripe.PaymentIntent,
          );
          break;
        case 'charge.refunded':
          await handleChargeRefunded(event.data.object as Stripe.Charge);
          break;
        default:
          logger.info(`Unhandled Stripe event type: ${event.type}`);
      }
    } catch (err) {
      logger.error(`Webhook handler error for ${event.type}`, { err });
      // Let go of the claim and fail, so Stripe delivers it again. Otherwise
      // a passing Firestore or Resend error would leave a paid booking
      // unconfirmed, or a confirmed one without its email, for good.
      await eventRef.delete().catch((deleteErr) =>
        logger.error(`Could not release claim on ${event.id}`, { deleteErr }),
      );
      res.status(500).json({ received: false });
      return;
    }

    await eventRef
      .update({ status: 'done', processedAt: FieldValue.serverTimestamp() })
      .catch((err) => logger.warn(`Could not mark ${event.id} done`, { err }));
    res.status(200).json({ received: true });
  },
);

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function emailPaidAfterCancellation(alert: PaidAfterCancellation) {
  const { subject, html, text } = buildPaidAfterCancellationEmail(alert);
  const { error } = await getResend().emails.send({
    from: getFromAddress(),
    to: [ADMIN_EMAIL.value()],
    subject,
    html,
    text,
    replyTo: alert.booking.customerEmail,
    headers: { 'X-Entity-Ref-ID': alert.booking.id },
  });
  if (error) throw new Error(`Resend failed: ${error.message ?? 'unknown error'}`);
}

/** Frees the seats of a booking whose checkout ended without a payment. */
async function releaseUnpaidBooking(
  session: Stripe.Checkout.Session,
  reason: string,
) {
  const bookingId = session.metadata?.bookingId;
  if (!bookingId) return;

  const ref = db.collection('bookings').doc(bookingId);
  await db.runTransaction(async (tx) => {
    const booking = (await tx.get(ref)).data();
    if (booking?.status !== 'pending-payment') return;
    tx.update(ref, {
      status: 'cancelled',
      paymentStatus: 'failed',
      cancellationReason: reason,
      cancelledAt: FieldValue.serverTimestamp(),
      cancelledBy: 'admin',
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
}

async function handlePaymentFailed(pi: Stripe.PaymentIntent) {
  const bookingId = pi.metadata?.bookingId;
  if (!bookingId) return;

  // A card declined during checkout. Only a booking still waiting to be
  // paid is marked: a retried delivery can arrive after the customer paid
  // with another card, and mustn't mark that booking failed.
  const ref = db.collection('bookings').doc(bookingId);
  await db.runTransaction(async (tx) => {
    const booking = (await tx.get(ref)).data();
    if (booking?.status !== 'pending-payment' || booking.paymentStatus !== 'pending') return;
    tx.update(ref, {
      paymentStatus: 'failed',
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
}

async function handleChargeRefunded(charge: Stripe.Charge) {
  const piId =
    typeof charge.payment_intent === 'string'
      ? charge.payment_intent
      : charge.payment_intent?.id;
  if (!piId) return;

  const bookingsSnap = await db
    .collection('bookings')
    .where('stripePaymentIntentId', '==', piId)
    .limit(1)
    .get();
  if (bookingsSnap.empty) return;

  const ref = bookingsSnap.docs[0]!.ref;
  // Refund totals only go up. A retried delivery of an earlier refund's
  // event can land after a later one, and mustn't wind the total back
  // (that would let a cancel try to refund money that's already gone).
  await db.runTransaction(async (tx) => {
    const booking = (await tx.get(ref)).data();
    if (!booking) return;
    const refundedTotal = Math.max(booking.amountRefundedCents ?? 0, charge.amount_refunded);
    if (refundedTotal === booking.amountRefundedCents) return;
    tx.update(ref, {
      amountRefundedCents: refundedTotal,
      paymentStatus: refundedTotal >= charge.amount ? 'refunded' : 'partial-refund',
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
}

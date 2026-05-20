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
} from './lib/resend';
import { APP_BASE_URL, ADMIN_EMAIL } from './lib/config';
import { sendBookingConfirmation } from './lib/send-confirmation';

/**
 * Stripe webhook endpoint.
 *
 * Configure in the Stripe dashboard with the deployed URL:
 *   https://<region>-<project>.cloudfunctions.net/stripeWebhook
 * Events to subscribe:
 *   - checkout.session.completed   (booking confirmed)
 *   - checkout.session.expired     (release the hold)
 *   - payment_intent.payment_failed
 *   - charge.refunded              (sync refunds we issue from admin)
 *
 * Idempotent: every event id is recorded in `stripeWebhookEvents/{event.id}`;
 * duplicate deliveries short-circuit.
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

    // Idempotency: stash the event id; bail if we've already processed it.
    const eventRef = db.collection('stripeWebhookEvents').doc(event.id);
    const existing = await eventRef.get();
    if (existing.exists) {
      logger.info(`Duplicate webhook ${event.id} (${event.type}) — ignoring`);
      res.status(200).json({ received: true, duplicate: true });
      return;
    }
    await eventRef.set({
      id: event.id,
      type: event.type,
      receivedAt: FieldValue.serverTimestamp(),
    });

    // Suppress noisy "unused secret" warnings — the secrets we don't read here
    // are referenced by sendBookingConfirmation downstream.
    void ADMIN_EMAIL;

    try {
      switch (event.type) {
        case 'checkout.session.completed':
          await handleCheckoutCompleted(
            event.data.object as Stripe.Checkout.Session,
          );
          break;
        case 'checkout.session.expired':
          await handleCheckoutExpired(
            event.data.object as Stripe.Checkout.Session,
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
      // 200 anyway — Stripe retries on 5xx and we don't want loops on a bug.
      // The event is recorded; we can replay manually if needed.
    }

    res.status(200).json({ received: true });
  },
);

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  const bookingId = session.metadata?.bookingId;
  if (!bookingId) {
    logger.warn('checkout.session.completed without bookingId metadata', {
      sessionId: session.id,
    });
    return;
  }

  const ref = db.collection('bookings').doc(bookingId);
  const snap = await ref.get();
  if (!snap.exists) {
    logger.warn(`Booking ${bookingId} not found for completed session`);
    return;
  }

  const paymentStatus = session.payment_status === 'paid' ? 'paid' : 'pending';

  await ref.update({
    status: paymentStatus === 'paid' ? 'confirmed' : 'pending-payment',
    paymentStatus,
    amountPaidCents: session.amount_total ?? 0,
    stripePaymentIntentId:
      typeof session.payment_intent === 'string'
        ? session.payment_intent
        : (session.payment_intent?.id ?? null),
    updatedAt: FieldValue.serverTimestamp(),
  });

  if (paymentStatus === 'paid') {
    await sendBookingConfirmation(bookingId);
  }
}

async function handleCheckoutExpired(session: Stripe.Checkout.Session) {
  const bookingId = session.metadata?.bookingId;
  if (!bookingId) return;

  const ref = db.collection('bookings').doc(bookingId);
  const snap = await ref.get();
  if (!snap.exists) return;

  const booking = snap.data();
  if (booking?.status === 'pending-payment') {
    await ref.update({
      status: 'cancelled',
      paymentStatus: 'failed',
      cancellationReason: 'Checkout session expired',
      cancelledAt: FieldValue.serverTimestamp(),
      cancelledBy: 'admin',
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
}

async function handlePaymentFailed(pi: Stripe.PaymentIntent) {
  const bookingId = pi.metadata?.bookingId;
  if (!bookingId) return;

  const ref = db.collection('bookings').doc(bookingId);
  await ref.update({
    paymentStatus: 'failed',
    updatedAt: FieldValue.serverTimestamp(),
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
  const refundedTotal = charge.amount_refunded;
  const fullyRefunded = refundedTotal === charge.amount;

  await ref.update({
    amountRefundedCents: refundedTotal,
    paymentStatus: fullyRefunded ? 'refunded' : 'partial-refund',
    updatedAt: FieldValue.serverTimestamp(),
  });
}

import { onRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import { db, FieldValue } from './lib/firebase';
import {
  STRIPE_SECRET_KEY,
  getStripe,
} from './lib/stripe';
import { APP_BASE_URL } from './lib/config';
import { getTourBySlug, totalCents } from './lib/tours';
import {
  checkAvailability,
  AvailabilityError,
} from './lib/availability';
import {
  applyCors,
  badRequest,
  methodNotAllowed,
  serverError,
} from './lib/http';
import type { Booking } from './lib/types';

// ---------------------------------------------------------------------------
// Request schema
// ---------------------------------------------------------------------------

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

const guestSchema = z.object({
  name: z.string().trim().min(1).max(120),
  age: z.number().int().min(0).max(120).nullable(),
});

const requestSchema = z.object({
  tourSlug: z.string().regex(/^[a-z0-9-]+$/, 'Invalid tour slug'),
  date: isoDate,
  guestCount: z.number().int().min(1).max(6),
  customer: z.object({
    name: z.string().trim().min(1).max(120),
    email: z.string().trim().toLowerCase().email().max(160),
    phone: z.string().trim().min(7).max(40),
  }),
  emergencyContact: z.object({
    name: z.string().trim().min(1).max(120),
    phone: z.string().trim().min(7).max(40),
  }),
  guests: z.array(guestSchema).min(1).max(6),
  acknowledgements: z.object({
    manateeManners: z.literal(true),
    liabilityWaiver: z.literal(true),
  }),
});

export type CreateCheckoutSessionRequest = z.infer<typeof requestSchema>;

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export const createCheckoutSession = onRequest(
  {
    cors: false, // we apply CORS manually for explicit origin allow-list
    secrets: [STRIPE_SECRET_KEY, APP_BASE_URL],
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
    const input = parsed.data;

    if (input.guests.length !== input.guestCount) {
      badRequest(res, 'guestCount must match the guests array length');
      return;
    }

    // Look up the tour first so we can short-circuit on a bad slug.
    const tour = await getTourBySlug(input.tourSlug);
    if (!tour || !tour.active) {
      badRequest(res, `Tour "${input.tourSlug}" is not bookable.`);
      return;
    }

    // -----------------------------------------------------------------------
    // Transactionally check availability + create the booking in
    // `pending-payment` state. We commit before contacting Stripe so we have
    // a doc to attach the session id to.
    // -----------------------------------------------------------------------

    const accessToken = randomUUID();
    const bookingRef = db.collection('bookings').doc();
    const now = FieldValue.serverTimestamp();
    const total = totalCents(tour, input.guestCount);

    try {
      await db.runTransaction(async (tx) => {
        await checkAvailability({
          tour,
          date: input.date,
          guestCount: input.guestCount,
          tx,
        });

        const booking: Omit<Booking, 'createdAt' | 'updatedAt' |
          'manateeMannersAcknowledgedAt' | 'liabilityWaiverSignedAt'> & {
            createdAt: FirebaseFirestore.FieldValue;
            updatedAt: FirebaseFirestore.FieldValue;
            manateeMannersAcknowledgedAt: FirebaseFirestore.FieldValue;
            liabilityWaiverSignedAt: FirebaseFirestore.FieldValue;
        } = {
          id: bookingRef.id,
          tourId: tour.id,
          tourName: tour.name,
          date: input.date,
          timeSlot: tour.timeSlot,
          type: tour.type,
          guestCount: input.guestCount,
          customerName: input.customer.name,
          customerEmail: input.customer.email,
          customerPhone: input.customer.phone,
          emergencyContactName: input.emergencyContact.name,
          emergencyContactPhone: input.emergencyContact.phone,
          guests: input.guests,
          status: 'pending-payment',
          amountPaidCents: 0,
          amountRefundedCents: 0,
          paymentStatus: 'pending',
          manateeMannersAcknowledged: true,
          manateeMannersAcknowledgedAt: now,
          liabilityWaiverSigned: true,
          liabilityWaiverSignedAt: now,
          accessToken,
          createdAt: now,
          updatedAt: now,
        };

        tx.set(bookingRef, booking);
      });
    } catch (err) {
      if (err instanceof AvailabilityError) {
        res.status(409).json({
          error: err.message,
          reason: err.reason,
          unavailable: true,
        });
        return;
      }
      serverError(res, err);
      return;
    }

    // -----------------------------------------------------------------------
    // Create the Stripe Checkout session and link it back to the booking.
    // If Stripe call fails, mark the booking as failed (frees the slot).
    // -----------------------------------------------------------------------

    const stripe = getStripe();
    const appBase = APP_BASE_URL.value();
    const confirmationUrl = `${appBase}/book/confirmation/${bookingRef.id}?t=${accessToken}`;
    const cancelUrl = `${appBase}/book/${input.date}/${input.tourSlug}?cancelled=1`;

    try {
      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        ui_mode: 'hosted',
        customer_email: input.customer.email,
        line_items: [
          {
            price_data: {
              currency: 'usd',
              unit_amount: total,
              product_data: {
                name: `${tour.name} — ${input.date}`,
                description:
                  tour.type === 'private'
                    ? `Private boat (${input.guestCount} guests)`
                    : `Shared tour, ${input.guestCount} guest${input.guestCount === 1 ? '' : 's'}`,
              },
            },
            quantity: 1,
          },
        ],
        metadata: {
          bookingId: bookingRef.id,
          tourSlug: input.tourSlug,
          date: input.date,
          guestCount: String(input.guestCount),
        },
        payment_intent_data: {
          metadata: {
            bookingId: bookingRef.id,
          },
          description: `Crystal River Manatee Fun — ${tour.name} (${input.date})`,
        },
        success_url: `${confirmationUrl}&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: cancelUrl,
        expires_at: Math.floor(Date.now() / 1000) + 30 * 60, // 30 minutes
      });

      await bookingRef.update({
        stripeCheckoutSessionId: session.id,
        updatedAt: FieldValue.serverTimestamp(),
      });

      logger.info('Created checkout session', {
        bookingId: bookingRef.id,
        sessionId: session.id,
        amount: total,
      });

      res.status(200).json({
        bookingId: bookingRef.id,
        accessToken,
        checkoutUrl: session.url,
      });
    } catch (err) {
      // Roll the booking back to a failed state so the slot frees up.
      await bookingRef
        .update({
          status: 'cancelled',
          paymentStatus: 'failed',
          cancellationReason: 'Stripe Checkout session creation failed',
          cancelledAt: FieldValue.serverTimestamp(),
          cancelledBy: 'admin',
          updatedAt: FieldValue.serverTimestamp(),
        })
        .catch(() => undefined);
      serverError(res, err);
    }
  },
);

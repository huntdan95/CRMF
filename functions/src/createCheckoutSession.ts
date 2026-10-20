import { onRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { randomUUID } from 'node:crypto';
import type Stripe from 'stripe';
import { z } from 'zod';

import { db, FieldValue } from './lib/firebase';
import {
  STRIPE_SECRET_KEY,
  getStripe,
} from './lib/stripe';
import { APP_BASE_URL } from './lib/config';
import { RESEND_API_KEY, RESEND_FROM_EMAIL } from './lib/resend';
import { getRateSeasonsOn, getTourBySlug } from './lib/tours';
import { seasonFor, totalOn } from './lib/pricing';
import {
  checkAvailability,
  AvailabilityError,
} from './lib/availability';
import { isRealDate } from './lib/datetime';
import { releaseHold } from './lib/checkout-hold';
import { getAutomationSettings, wetsuitSizeValues } from './lib/site-settings';
import {
  CheckoutLimitError,
  assertCheckoutAllowed,
  checkoutIpHash,
  readForwardedFor,
  sendCheckoutLimitAlert,
} from './lib/checkout-limit';
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

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .refine(isRealDate, 'Not a real calendar date');

const guestSchema = z.object({
  name: z.string().trim().min(1).max(120),
  age: z.number().int().min(0).max(120).nullable(),
  // Checked against the stocked sizes below. Optional here so a booking
  // page loaded before sizes were asked for still checks out.
  wetsuitSize: z.string().trim().max(20).nullable().optional(),
});

export const requestSchema = z.object({
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
    // Required for every swim; the sunset cruise has no swim (checked below).
    manateeManners: z.boolean(),
    liabilityWaiver: z.literal(true),
    // Optional so a booking page loaded before this deploy can still pay.
    termsOfService: z.literal(true).optional(),
  }),
  /** The Terms of Service date the checkout page showed (TERMS_VERSION). */
  termsVersion: isoDate.optional(),
  /**
   * The unpaid checkout this one replaces (the customer backed out of
   * Stripe and is trying again). Its seats are released first.
   */
  previousBooking: z
    .object({
      bookingId: z.string().min(1).max(64),
      accessToken: z.string().min(8).max(64),
    })
    .optional(),
});

export type CreateCheckoutSessionRequest = z.infer<typeof requestSchema>;

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export const createCheckoutSession = onRequest(
  {
    cors: false, // we apply CORS manually for explicit origin allow-list
    // Resend for the email to Travis when a visitor is turned away
    // (lib/checkout-limit.ts).
    secrets: [STRIPE_SECRET_KEY, APP_BASE_URL, RESEND_API_KEY, RESEND_FROM_EMAIL],
    maxInstances: 10,
    // Up to four Stripe calls (expire + retrieve an earlier hold, create,
    // and expire the new session if the seats went meanwhile), each allowed
    // ~30s by lib/stripe.ts. Being stopped part way strands no seats: the
    // booking is only ever saved together with its session.
    timeoutSeconds: 120,
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

    // Every size given has to be one Travis stocks (Admin → Settings).
    // Shaped like a zod error so the booking form marks the right field.
    const stocked = wetsuitSizeValues((await getAutomationSettings()).wetsuitSizes);
    const badSizes = Object.fromEntries(
      input.guests.flatMap((g, i) =>
        g.wetsuitSize && !stocked.includes(g.wetsuitSize)
          ? [[String(i), { wetsuitSize: { _errors: ['Pick a size from the list.'] } }]]
          : [],
      ),
    );
    if (Object.keys(badSizes).length > 0) {
      badRequest(res, 'Pick a wetsuit size from the list.', { guests: badSizes });
      return;
    }

    // Look up the tour first so we can short-circuit on a bad slug.
    const tour = await getTourBySlug(input.tourSlug);
    if (!tour || !tour.active) {
      badRequest(res, 'That departure isn’t running right now. Please pick another one.');
      return;
    }
    const swim = tour.timeSlot !== 'sunset';
    if (swim && !input.acknowledgements.manateeManners) {
      badRequest(res, 'Please confirm you’ve watched the manatee manners video.');
      return;
    }

    const stripe = getStripe();

    // Who's asking, as far as the checkout limit goes (lib/checkout-limit.ts
    // explains which address that is). Only its hash is kept.
    const forwarded = readForwardedFor(req.headers);
    const ip = forwarded.ip;
    const ipHash = ip ? checkoutIpHash(ip) : null;
    // For the launch check (README): which X-Forwarded-For entry counted,
    // out of how many. Never the address or its hash.
    logger.info('Checkout visitor address', { forwardedForEntries: forwarded.entries, entryUsed: forwarded.index });

    // Turned away for having too many unpaid checkouts open. Travis hears
    // about it before the answer goes back: an instance may be stopped once
    // the response is sent.
    const refuseOverLimit = async (err: CheckoutLimitError) => {
      logger.warn('Too many unpaid checkouts from one visitor; turned away', {
        checkoutIpHash: ipHash,
        open: err.open.map((b) => b.id),
      });
      if (ipHash) {
        await sendCheckoutLimitAlert({
          ipHash,
          attempt: {
            customer: input.customer,
            tour,
            date: input.date,
            guestCount: input.guestCount,
          },
          open: err.open,
        }).catch((alertErr) =>
          logger.error('Could not email the checkout limit alert', { err: alertErr }),
        );
      }
      res.status(429).json({ error: err.message, reason: 'too-many-checkouts' });
    };

    // A customer retrying after backing out of Stripe would otherwise be
    // blocked by their own unpaid hold until it expires. Release it before
    // checking seats. Not fatal if it fails: the hold still expires.
    if (input.previousBooking) {
      try {
        const outcome = await releaseHold(input.previousBooking, { stripe });
        logger.info('Released earlier checkout hold', {
          bookingId: input.previousBooking.bookingId,
          outcome,
        });
      } catch (err) {
        logger.warn('Could not release earlier checkout hold', {
          bookingId: input.previousBooking.bookingId,
          err,
        });
      }
    }

    // Seasonal rates for the tour date; the booking page shows the same.
    const seasons = await getRateSeasonsOn(input.date);
    const season = seasonFor(tour, input.date, seasons);

    const accessToken = randomUUID();
    const bookingRef = db.collection('bookings').doc();
    const now = FieldValue.serverTimestamp();
    const total = totalOn(tour, input.guestCount, input.date, seasons);

    // -----------------------------------------------------------------------
    // Create the Stripe Checkout session first, so the booking can be saved
    // with its session id in the same write that holds its seats. A hold
    // without a session would never be released: nothing could expire it,
    // and the customer never got its id or token to let it go. This way
    // Stripe's checkout.session.expired frees every hold within about 30
    // minutes, even if the function dies right after the transaction.
    // -----------------------------------------------------------------------

    // A plain read first, so a visitor with too many unpaid checkouts open,
    // or a departure that's full, too close or too far out, is turned down
    // without making a session only to expire it. The transaction below
    // checks again and decides.
    try {
      await assertCheckoutAllowed({ ipHash, replacing: input.previousBooking });
      await checkAvailability({ tour, date: input.date, guestCount: input.guestCount });
    } catch (err) {
      if (err instanceof CheckoutLimitError) {
        await refuseOverLimit(err);
        return;
      }
      if (err instanceof AvailabilityError) {
        res.status(409).json({ error: err.message, reason: err.reason, unavailable: true });
        return;
      }
      serverError(res, err);
      return;
    }

    const appBase = APP_BASE_URL.value();
    const confirmationUrl = `${appBase}/book/confirmation/${bookingRef.id}?t=${accessToken}`;
    const cancelUrl = `${appBase}/book/${input.date}/${input.tourSlug}?cancelled=1`;

    let session: Stripe.Checkout.Session;
    try {
      session = await stripe.checkout.sessions.create({
        mode: 'payment',
        ui_mode: 'hosted',
        // Card only; Apple Pay and Google Pay come with it. Left to the
        // Stripe dashboard, Checkout can also offer bank debits, which take
        // days to clear: the session completes unpaid, the booking holds its
        // seats unconfirmed all that time, and the payment can still fail
        // after the trip has gone out. A card is paid or declined right here.
        payment_method_types: ['card'],
        customer_email: input.customer.email,
        line_items: [
          {
            price_data: {
              currency: 'usd',
              unit_amount: total,
              product_data: {
                name: `${tour.name} — ${input.date}`,
                description:
                  (tour.type === 'private'
                    ? `Private boat (${input.guestCount} guests)`
                    : `Shared tour, ${input.guestCount} guest${input.guestCount === 1 ? '' : 's'}`) +
                  (season ? ` · ${season.name} rate` : ''),
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
          ...(season && { rateSeasonId: season.id }),
        },
        payment_intent_data: {
          metadata: {
            bookingId: bookingRef.id,
          },
          description: `Crystal River Manatee Fun — ${tour.name} (${input.date})`,
        },
        success_url: `${confirmationUrl}&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: cancelUrl,
        // 30 minutes is the shortest Stripe takes, counted from when it gets
        // the request: asking for exactly that, a slow request or a clock a
        // little ahead of Stripe's gets the session refused. One more minute
        // leaves room.
        expires_at: Math.floor(Date.now() / 1000) + 31 * 60,
      });
    } catch (err) {
      // No booking yet, so no seats to free.
      serverError(res, err);
      return;
    }

    // -----------------------------------------------------------------------
    // Transactionally check the visitor's checkout limit + availability and
    // create the booking in `pending-payment` state, linked to its session.
    // -----------------------------------------------------------------------

    try {
      await db.runTransaction(async (tx) => {
        await assertCheckoutAllowed({ ipHash, replacing: input.previousBooking, tx });
        await checkAvailability({
          tour,
          date: input.date,
          guestCount: input.guestCount,
          tx,
        });

        const booking: Omit<Booking, 'createdAt' | 'updatedAt' |
          'manateeMannersAcknowledgedAt' | 'liabilityWaiverSignedAt' | 'termsAcceptedAt'> & {
            createdAt: FirebaseFirestore.FieldValue;
            updatedAt: FirebaseFirestore.FieldValue;
            manateeMannersAcknowledgedAt: FirebaseFirestore.FieldValue | null;
            liabilityWaiverSignedAt: FirebaseFirestore.FieldValue;
            termsAcceptedAt?: FirebaseFirestore.FieldValue;
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
          guests: input.guests.map((g) => ({
            name: g.name,
            age: g.age,
            wetsuitSize: g.wetsuitSize || null,
          })),
          status: 'pending-payment',
          stripeCheckoutSessionId: session.id,
          amountPaidCents: 0,
          amountRefundedCents: 0,
          paymentStatus: 'pending',
          // Nobody swims on the sunset cruise, so it isn't asked for there.
          manateeMannersAcknowledged: swim,
          manateeMannersAcknowledgedAt: swim ? now : null,
          liabilityWaiverSigned: true,
          liabilityWaiverSignedAt: now,
          ...(input.acknowledgements.termsOfService && {
            termsAcceptedAt: now,
            ...(input.termsVersion ? { termsVersion: input.termsVersion } : {}),
          }),
          accessToken,
          // Counts this checkout against the visitor's limit.
          ...(ipHash && { checkoutIpHash: ipHash }),
          createdAt: now,
          updatedAt: now,
        };

        tx.set(bookingRef, booking);
      });
    } catch (err) {
      // Nobody was given this session's URL, so it can't be paid. Expire it
      // so it doesn't sit open in Stripe. If that fails it lapses in 30
      // minutes, and should the transaction have committed after all, its
      // expired event releases the booking.
      await stripe.checkout.sessions.expire(session.id).catch((expireErr) =>
        logger.warn('Could not expire unused checkout session', {
          bookingId: bookingRef.id,
          sessionId: session.id,
          err: expireErr,
        }),
      );
      if (err instanceof CheckoutLimitError) {
        await refuseOverLimit(err);
        return;
      }
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
  },
);

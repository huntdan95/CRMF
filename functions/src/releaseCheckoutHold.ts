import { onRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { z } from 'zod';

import { STRIPE_SECRET_KEY, getStripe } from './lib/stripe';
import { releaseHold } from './lib/checkout-hold';
import {
  applyCors,
  badRequest,
  methodNotAllowed,
  serverError,
} from './lib/http';

const requestSchema = z.object({
  bookingId: z.string().min(1).max(64),
  accessToken: z.string().min(8).max(64),
});

/**
 * POST /releaseCheckoutHold  { bookingId, accessToken }
 *   → { outcome: ReleaseOutcome }
 *
 * The booking page calls this when a customer comes back from Stripe
 * without paying, so their unpaid hold stops blocking the seats (theirs
 * and everyone else's) right away instead of 30 minutes later.
 * Token-authenticated like fetchBooking / cancelBooking. Only ever touches a
 * `pending-payment` booking whose Stripe session it could expire.
 */
export const releaseCheckoutHold = onRequest(
  {
    cors: false,
    secrets: [STRIPE_SECRET_KEY],
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
      badRequest(res, 'Missing bookingId or accessToken', parsed.error.format());
      return;
    }

    try {
      const outcome = await releaseHold(parsed.data, { stripe: getStripe() });
      if (outcome === 'not-found') {
        res.status(404).json({ error: 'Booking not found' });
        return;
      }
      logger.info('releaseCheckoutHold', {
        bookingId: parsed.data.bookingId,
        outcome,
      });
      res.status(200).json({ outcome });
    } catch (err) {
      serverError(res, err);
    }
  },
);

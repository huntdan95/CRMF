import { onRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { z } from 'zod';

import { RESEND_API_KEY, RESEND_FROM_EMAIL } from './lib/resend';
import { sendEmail } from './lib/email-log';
import { APP_BASE_URL, ADMIN_EMAIL } from './lib/config';
import { moveClosedBooking as move } from './lib/closure';
import { isRealDate } from './lib/datetime';
import { buildBookingConfirmation } from './lib/email-templates';
import { getRateSeasonsOn, getTourBySlug } from './lib/tours';
import { applyCors, badRequest, methodNotAllowed, serverError } from './lib/http';

const MARINA = {
  name: "Pete's Pier Marina",
  address: '1 SW First Place, Crystal River, FL 34429',
};
const PHONE_DISPLAY = '352-586-7792';

const requestSchema = z.object({
  bookingId: z.string().min(1).max(64),
  accessToken: z.string().min(8).max(64),
  newDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(isRealDate, 'Not a real calendar date'),
  newTourSlug: z.string().min(1).max(64),
});

/**
 * POST /moveClosedBooking
 *
 * The customer moving a booking Travis closed (see lib/closure.ts) to
 * another open departure, from their booking page. Token-authenticated.
 * Moves it straight away, unlike requestReschedule, which asks Travis:
 * closing the departure already said he's fine with a move. The customer
 * gets the updated confirmation, copied to Travis.
 */
export const moveClosedBooking = onRequest(
  {
    cors: false,
    secrets: [RESEND_API_KEY, RESEND_FROM_EMAIL, APP_BASE_URL],
    maxInstances: 10,
  },
  async (req, res) => {
    if (applyCors(req, res)) return;
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

    const parsed = requestSchema.safeParse(req.body);
    if (!parsed.success) return badRequest(res, 'Invalid input', parsed.error.format());

    try {
      const outcome = await move(parsed.data, { getTour: getTourBySlug, getSeasons: getRateSeasonsOn });
      switch (outcome.kind) {
        case 'not-found':
          res.status(404).json({ error: 'Booking not found' });
          return;
        case 'bad-token':
          res.status(403).json({ error: 'Invalid access token' });
          return;
        case 'not-closed':
          res.status(409).json({
            error: 'This booking isn’t waiting on a new date any more. Reload the page to see where it stands.',
          });
          return;
        case 'expired':
          res.status(409).json({
            error: `The time to pick a new date has passed, so your booking is being refunded. Call or text Travis at ${PHONE_DISPLAY} if you’d still like to go.`,
          });
          return;
        case 'not-allowed':
        case 'unavailable':
          res.status(409).json({ error: outcome.message, reason: outcome.kind });
          return;
        case 'moved':
          break;
      }

      try {
        const adminEmail = ADMIN_EMAIL.value();
        const { subject, html, text } = buildBookingConfirmation({
          booking: outcome.booking,
          baseUrl: APP_BASE_URL.value(),
          marina: MARINA,
          phoneDisplay: PHONE_DISPLAY,
        });
        await sendEmail({
          kind: 'reschedule',
          bookingId: outcome.booking.id,
          to: outcome.booking.customerEmail,
          bcc: adminEmail,
          subject: `Updated: ${subject}`,
          html,
          text,
          replyTo: adminEmail,
          headers: { 'X-Entity-Ref-ID': outcome.booking.id },
        });
      } catch (err) {
        // The move stands; the booking page shows the new date.
        logger.error('Moved-booking confirmation email failed', { bookingId: outcome.booking.id, err });
      }

      res.status(200).json({
        ok: true,
        booking: { date: outcome.booking.date, timeSlot: outcome.booking.timeSlot, tourId: outcome.booking.tourId },
      });
    } catch (err) {
      serverError(res, err);
    }
  },
);

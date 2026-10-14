import { onRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { z } from 'zod';

import { db, FieldValue } from './lib/firebase';
import {
  RESEND_API_KEY,
  RESEND_FROM_EMAIL,
  getResend,
  getFromAddress,
} from './lib/resend';
import { ADMIN_EMAIL } from './lib/config';
import {
  buildRescheduleAckEmail,
  buildRescheduleRequestEmail,
} from './lib/email-templates';
import { hoursUntilTour, isRealDate, marinaNow } from './lib/datetime';
import { SLOT_START_TIMES } from './lib/schedule';
import {
  applyCors,
  badRequest,
  methodNotAllowed,
} from './lib/http';
import type { Booking, TourTimeSlot } from './lib/types';

const MARINA = {
  name: "Pete's Pier Marina",
  address: '1 SW First Place, Crystal River, FL 34429',
};
const PHONE_DISPLAY = '352-586-7792';

const requestSchema = z.object({
  bookingId: z.string().min(1).max(64),
  accessToken: z.string().min(8).max(64),
  requestedDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine(isRealDate, 'Not a real calendar date'),
  requestedSlot: z
    .enum(['morning', 'mid-morning', 'early-afternoon', 'late-afternoon', 'whole-day'])
    .optional(),
  notes: z.string().trim().max(1000).optional(),
});

/**
 * POST /requestReschedule
 *
 * Customer-initiated reschedule request. It doesn't move the booking —
 * Travis confirms it from admin. We:
 *   1. Validate the token, and that the request makes sense (a real,
 *      future date that isn't the one already booked; a tour that hasn't
 *      happened; no other request still open).
 *   2. Write a `rescheduleRequests` doc for admin tracking.
 *   3. Email Travis the details (replies go to the customer), and send the
 *      customer their own acknowledgement (replies go to Travis).
 */
export const requestReschedule = onRequest(
  {
    cors: false,
    secrets: [RESEND_API_KEY, RESEND_FROM_EMAIL],
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
    const { bookingId, accessToken, requestedDate, requestedSlot, notes } = parsed.data;

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
    if (booking.status !== 'confirmed' && booking.status !== 'pending-payment') {
      res.status(409).json({
        error: 'Only active bookings can be rescheduled. Call Travis if this is wrong.',
      });
      return;
    }
    const today = marinaNow().date;
    const departs = SLOT_START_TIMES[booking.timeSlot];
    if (booking.date < today || (departs !== undefined && hoursUntilTour(booking.date, departs) < 0)) {
      res.status(409).json({ error: 'This tour has already happened, so it can’t be moved.' });
      return;
    }
    if (requestedDate < today) {
      badRequest(res, 'Pick a date that hasn’t passed yet.');
      return;
    }
    if (requestedDate === booking.date && (requestedSlot ?? booking.timeSlot) === booking.timeSlot) {
      badRequest(res, 'That’s the tour you’re already booked on. Pick a different date or time.');
      return;
    }

    // One open request at a time: a double tap or a retry shouldn't queue
    // (and email Travis) the same request twice.
    const open = await db
      .collection('rescheduleRequests')
      .where('bookingId', '==', bookingId)
      .where('status', '==', 'open')
      .limit(1)
      .get();
    if (!open.empty) {
      res.status(409).json({
        error: `You've already asked to move this tour, and Travis hasn't answered yet. To change the request, call or text him at ${PHONE_DISPLAY}.`,
      });
      return;
    }

    // Record the request for the admin queue (Admin → Reschedules).
    const requestRef = await db.collection('rescheduleRequests').add({
      bookingId,
      bookingCustomerEmail: booking.customerEmail,
      bookingDate: booking.date,
      bookingTimeSlot: booking.timeSlot as TourTimeSlot,
      requestedDate,
      requestedSlot: requestedSlot ?? null,
      notes: notes ?? null,
      status: 'open',
      createdAt: FieldValue.serverTimestamp(),
    });

    // Email Travis.
    try {
      const resend = getResend();
      const from = getFromAddress();
      const adminEmail = ADMIN_EMAIL.value();

      const { subject, html, text } = buildRescheduleRequestEmail({
        booking,
        requestedDate,
        requestedSlot,
        notes,
        marina: MARINA,
      });

      // Travis's copy: replying goes straight to the customer.
      const toTravis = await resend.emails.send({
        from,
        to: [adminEmail],
        subject,
        html,
        text,
        replyTo: booking.customerEmail,
        headers: {
          'X-Entity-Ref-ID': bookingId,
          'X-Reschedule-Request-ID': requestRef.id,
        },
      });
      if (toTravis.error) throw new Error(`Resend failed: ${toTravis.error.message ?? 'unknown'}`);

      // The customer's acknowledgement: replying goes to Travis.
      const ack = buildRescheduleAckEmail({
        booking,
        requestedDate,
        requestedSlot,
        phoneDisplay: PHONE_DISPLAY,
      });
      const toCustomer = await resend.emails.send({
        from,
        to: [booking.customerEmail],
        subject: ack.subject,
        html: ack.html,
        text: ack.text,
        replyTo: adminEmail,
        headers: {
          'X-Entity-Ref-ID': bookingId,
          'X-Reschedule-Request-ID': requestRef.id,
        },
      });
      if (toCustomer.error) throw new Error(`Resend failed: ${toCustomer.error.message ?? 'unknown'}`);
    } catch (err) {
      logger.error('Reschedule email failed', { bookingId, err });
      // Don't unwind — the Firestore record is the source of truth.
    }

    res.status(200).json({
      ok: true,
      requestId: requestRef.id,
    });
  },
);

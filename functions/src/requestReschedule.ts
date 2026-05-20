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
import { buildRescheduleRequestEmail } from './lib/email-templates';
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

const requestSchema = z.object({
  bookingId: z.string().min(1).max(64),
  accessToken: z.string().min(8).max(64),
  requestedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  requestedSlot: z
    .enum(['morning', 'mid-morning', 'early-afternoon', 'late-afternoon', 'whole-day'])
    .optional(),
  notes: z.string().trim().max(1000).optional(),
});

/**
 * POST /requestReschedule
 *
 * Customer-initiated reschedule request. v1 doesn't move the booking
 * automatically — Travis confirms it manually. We:
 *   1. Validate the token.
 *   2. Write a `rescheduleRequests` doc for admin tracking.
 *   3. Email Travis with the request details (customer is BCC'd a copy).
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

    // Record the request for the admin queue (Phase 6 will read this).
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

      await resend.emails.send({
        from,
        to: [adminEmail],
        bcc: [booking.customerEmail],
        subject,
        html,
        text,
        replyTo: booking.customerEmail,
        headers: {
          'X-Entity-Ref-ID': bookingId,
          'X-Reschedule-Request-ID': requestRef.id,
        },
      });
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

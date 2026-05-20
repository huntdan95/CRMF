import { onRequest } from 'firebase-functions/v2/https';
import { z } from 'zod';

import { db } from './lib/firebase';
import {
  applyCors,
  badRequest,
  methodNotAllowed,
  serverError,
} from './lib/http';
import type { Booking } from './lib/types';

/**
 * Token-authenticated booking read.
 *
 * Called from:
 *  - /book/confirmation/[id] right after Stripe redirect
 *  - /my-booking/[id] (Phase 5 self-service)
 *
 * Validates the `accessToken` against the doc — never trust the booking id
 * alone, since they're generated server-side and could be guessed. Returns
 * a sanitized projection so callers don't see admin-only fields.
 */
export const fetchBooking = onRequest(
  {
    cors: false,
    maxInstances: 10,
  },
  async (req, res) => {
    if (applyCors(req, res)) return;
    if (req.method !== 'POST' && req.method !== 'GET') {
      methodNotAllowed(res, ['GET', 'POST']);
      return;
    }

    const params = req.method === 'GET' ? req.query : (req.body ?? {});
    const parsed = z
      .object({
        bookingId: z.string().min(1).max(64),
        accessToken: z.string().min(8).max(64),
      })
      .safeParse(params);
    if (!parsed.success) {
      badRequest(res, 'Missing bookingId or accessToken', parsed.error.format());
      return;
    }

    try {
      const ref = db.collection('bookings').doc(parsed.data.bookingId);
      const snap = await ref.get();
      if (!snap.exists) {
        res.status(404).json({ error: 'Booking not found' });
        return;
      }
      const booking = snap.data() as Booking;

      // Constant-time string compare would be nicer; for now, plain `===`.
      if (booking.accessToken !== parsed.data.accessToken) {
        res.status(403).json({ error: 'Invalid access token' });
        return;
      }

      res.status(200).json({
        booking: serializeBooking(booking),
      });
    } catch (err) {
      serverError(res, err);
    }
  },
);

function serializeBooking(b: Booking) {
  // Project to fields safe to share with the customer (no adminNotes, etc.)
  return {
    id: b.id,
    tourId: b.tourId,
    tourName: b.tourName,
    date: b.date,
    timeSlot: b.timeSlot,
    type: b.type,
    guestCount: b.guestCount,
    customerName: b.customerName,
    customerEmail: b.customerEmail,
    customerPhone: b.customerPhone,
    emergencyContactName: b.emergencyContactName,
    emergencyContactPhone: b.emergencyContactPhone,
    guests: b.guests,
    status: b.status,
    paymentStatus: b.paymentStatus,
    amountPaidCents: b.amountPaidCents,
    amountRefundedCents: b.amountRefundedCents,
    accessToken: b.accessToken,
    createdAt: toIso(b.createdAt),
    updatedAt: toIso(b.updatedAt),
    cancelledAt: toIso(b.cancelledAt),
    cancellationReason: b.cancellationReason ?? null,
  };
}

function toIso(ts: unknown): string | null {
  if (!ts || typeof ts !== 'object') return null;
  if (typeof (ts as { toDate?: () => Date }).toDate === 'function') {
    return (ts as { toDate: () => Date }).toDate().toISOString();
  }
  return null;
}

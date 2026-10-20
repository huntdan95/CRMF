import { onRequest } from 'firebase-functions/v2/https';
import { z } from 'zod';

import { db } from './lib/firebase';
import { closedDeparturesOn, closurePendingFor, closurePendingMessage } from './lib/close-day';
import { marinaNow } from './lib/datetime';
import { tripIdFor } from './lib/trip-photos';
import {
  applyCors,
  badRequest,
  methodNotAllowed,
  serverError,
} from './lib/http';
import { isGoingAhead, type Booking } from './lib/types';

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

      // A closed day covers their trip but Travis left them on it (no
      // closure offer): the page says he'll be in touch instead of offering
      // the cancel that cancelBooking turns away.
      const active = booking.status === 'confirmed' || booking.status === 'pending-payment';
      const departureClosed =
        active && !booking.closure && (await closedDeparturesOn(db, booking.date))(booking.timeSlot);
      // Travis is calling it off right now ("cancel" or "offer", its undo
      // window open or going out): the email that cancels them or offers a
      // new date is minutes away, so the page says that, as cancelBooking's
      // 409 does, instead of inviting a date-change request for a trip about
      // to go. "Leave them booked" keeps the trip on: the page says he'll be
      // in touch.
      const pending = departureClosed ? await closurePendingFor(db, booking.date, booking.timeSlot) : null;
      const closurePending =
        pending && pending.choice !== 'keep'
          ? { choice: pending.choice, message: closurePendingMessage(pending.choice) }
          : null;

      // The booking page's "Your trip photos" card, once the crew have
      // uploaded some for a trip this booking went out on (the gallery's own
      // rule, src/lib/trip-photos-server.ts onTheBoat). Without it the card
      // would show for a trip Travis closed, or one with nothing uploaded,
      // and open a gallery that refuses them or stays empty.
      const wentOut =
        booking.status === 'completed' ||
        (isGoingAhead({ ...booking, id: snap.id }) && !booking.closure && !departureClosed);
      const hasTripPhotos =
        wentOut &&
        booking.date <= marinaNow().date &&
        !(
          await db
            .collection('tripPhotos')
            .doc(tripIdFor(booking.date, booking.timeSlot))
            .collection('files')
            .limit(1)
            .get()
        ).empty;

      res.status(200).json({
        booking: { ...serializeBooking(booking), departureClosed, closurePending, hasTripPhotos },
      });
    } catch (err) {
      serverError(res, err);
    }
  },
);

export function serializeBooking(b: Booking) {
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
    // Old-site money Travis refunds himself: the page says so instead of
    // showing a $0 refund.
    manualRefundCents: b.manualRefundCents ?? 0,
    // Set once Travis has refunded it: the page then says he has.
    manualRefundedAt: toIso(b.manualRefundedAt),
    accessToken: b.accessToken,
    createdAt: toIso(b.createdAt),
    updatedAt: toIso(b.updatedAt),
    cancelledAt: toIso(b.cancelledAt),
    // Not one Travis kept to himself by cancelling without emailing them.
    cancellationReason: b.cancellationReasonPrivate ? null : (b.cancellationReason ?? null),
    // Travis closed this departure: the page offers a new date or a refund.
    closure: b.closure ? { reason: b.closure.reason, decideBy: b.closure.decideBy } : null,
    // Travis reopened it after that offer: the cancel dialog shows the full
    // refund the offer promised until this date, as cancelBooking gives it.
    refundGraceUntil: b.refundGraceUntil ?? null,
  };
}

function toIso(ts: unknown): string | null {
  if (!ts || typeof ts !== 'object') return null;
  if (typeof (ts as { toDate?: () => Date }).toDate === 'function') {
    return (ts as { toDate: () => Date }).toDate().toISOString();
  }
  return null;
}

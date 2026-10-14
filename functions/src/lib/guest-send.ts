import { logger } from 'firebase-functions/v2';

import { db, FieldValue } from './firebase';
import { notifyGuest, type GuestSendResult, type Message } from './notify';
import type { Booking } from './types';

/** The sent-at markers on a booking, one per scheduled guest message. */
export type GuestMarker =
  | 'prepSentAt'
  | 'directionsSentAt'
  | 'postTourFollowupSentAt'
  | 'photosSentAt';

/**
 * Sends one scheduled message to a booking's lead guest and records
 * `<marker>` (plus the message id) on the booking. Skips a booking that
 * already has the marker or shouldn't get messages. Throws if sending
 * fails, leaving the marker unset so the next run tries again.
 */
export async function sendGuestOnce(
  booking: Booking & Partial<Record<GuestMarker, unknown>>,
  marker: GuestMarker,
  message: Message,
  opts: { bccOwner?: boolean; force?: boolean } = {},
): Promise<GuestSendResult | { sent: false; reason: 'already-sent' }> {
  if (booking[marker] && !opts.force) return { sent: false, reason: 'already-sent' };
  const result = await notifyGuest(booking, message, { bccOwner: opts.bccOwner });
  if (result.sent) {
    await db
      .collection('bookings')
      .doc(booking.id)
      .update({
        [marker]: FieldValue.serverTimestamp(),
        [marker.replace(/SentAt$/, 'MessageId')]: result.id,
      });
  }
  return result;
}

/**
 * Runs `send` for each booking on its own, so one failure doesn't stop
 * the rest. Returns how many went out.
 */
export async function forEachBooking(
  job: string,
  bookings: Booking[],
  send: (b: Booking) => Promise<{ sent: boolean }>,
): Promise<{ sent: number; failed: number; skipped: number }> {
  const counts = { sent: 0, failed: 0, skipped: 0 };
  for (const b of bookings) {
    try {
      const r = await send(b);
      if (r.sent) counts.sent++;
      else counts.skipped++;
    } catch (err) {
      counts.failed++;
      logger.error(`${job} failed for booking`, { bookingId: b.id, err });
    }
  }
  logger.info(`${job} run`, { candidates: bookings.length, ...counts });
  return counts;
}

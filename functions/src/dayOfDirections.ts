import { onSchedule } from 'firebase-functions/v2/scheduler';

import { db } from './lib/firebase';
import { RESEND_API_KEY, RESEND_FROM_EMAIL } from './lib/resend';
import { APP_BASE_URL } from './lib/config';
import { hoursUntilTour, marinaNow } from './lib/datetime';
import { slotStartTime } from './lib/schedule';
import { isGoing, isMessageable } from './lib/notify';
import { forEachBooking, sendGuestOnce } from './lib/guest-send';
import { buildDirectionsEmail } from './lib/guest-templates';
import type { Booking } from './lib/types';

/** Directions go out this long before departure... */
const DIRECTIONS_HOURS = 2;
/** ...but never before 6:00 AM marina time. */
const EARLIEST_MINUTES = 6 * 60;

/*
 * Day-of directions: the marina address with Google and Apple Maps links,
 * park and meet in the Pete's Pier parking lot, arrive 20 to 30 minutes
 * early, Travis's cell, and the My Booking link.
 *
 * Every 15 minutes. A booking gets it once its departure is 2 hours away
 * or less (so an early boat's guests get it at 6:00 AM), and not after the
 * boat has left. Marker: `directionsSentAt`.
 */
export const sendDayOfDirections = onSchedule(
  {
    schedule: 'every 15 minutes',
    timeZone: 'America/New_York',
    region: 'us-central1',
    secrets: [RESEND_API_KEY, RESEND_FROM_EMAIL, APP_BASE_URL],
    retryCount: 0,
  },
  async () => {
    await runDayOfDirections(new Date());
  },
);

export async function runDayOfDirections(now: Date) {
  const clock = marinaNow(now);
  if (clock.minutes < EARLIEST_MINUTES) return { sent: 0, failed: 0, skipped: 0 };

  const snap = await db.collection('bookings').where('date', '==', clock.date).get();
  const due = snap.docs
    .map((d) => ({ ...(d.data() as Booking & { directionsSentAt?: unknown }), id: d.id }))
    .filter((b) => {
      if (b.directionsSentAt || !isGoing(b) || !isMessageable(b)) return false;
      const hours = hoursUntilTour(b.date, slotStartTime(b.timeSlot, b.date), now);
      return hours <= DIRECTIONS_HOURS && hours > 0;
    });

  const baseUrl = APP_BASE_URL.value();
  return forEachBooking('Day-of directions', due, (b) =>
    sendGuestOnce(b, 'directionsSentAt', {
      type: 'day-of-directions',
      key: `directions/${b.id}/${b.date}_${b.timeSlot}`,
      ...buildDirectionsEmail({ booking: b, baseUrl }),
    }),
  );
}

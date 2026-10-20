import { onSchedule } from 'firebase-functions/v2/scheduler';

import { db } from './lib/firebase';
import { RESEND_API_KEY, RESEND_FROM_EMAIL } from './lib/resend';
import { APP_BASE_URL } from './lib/config';
import { addDays, hoursUntilTour, marinaNow } from './lib/datetime';
import { slotStartTime } from './lib/schedule';
import { getsAutomatedEmail, isGoing, onOpenDepartures } from './lib/notify';
import { forEachBooking, sendGuestOnce } from './lib/guest-send';
import { buildTripPrepEmail } from './lib/guest-templates';
import type { Booking } from './lib/types';

/** The prep email goes out this long before departure. */
const PREP_HOURS = 72;
/** Closer than this, the day-of directions email covers it instead. */
const TOO_CLOSE_HOURS = 12;

/*
 * Trip prep, year-round: what to wear and bring, what's provided, when to
 * arrive, where to park, the manatee manners video and the weather policy.
 *
 * Hourly. A booking gets it once its departure is 72 hours away or less;
 * one made inside that window gets it within the hour after booking. One
 * leaving in under 12 hours never gets it (directions cover that), nor
 * one on a departure Travis has closed or is closing. Marker: `prepSentAt`.
 */
export const sendTripPrep = onSchedule(
  {
    schedule: 'every 60 minutes',
    timeZone: 'America/New_York',
    region: 'us-central1',
    secrets: [RESEND_API_KEY, RESEND_FROM_EMAIL, APP_BASE_URL],
    retryCount: 0,
  },
  async () => {
    await runTripPrep(new Date());
  },
);

export async function runTripPrep(now: Date) {
  const today = marinaNow(now).date;
  const snap = await db
    .collection('bookings')
    .where('date', '>=', today)
    .where('date', '<=', addDays(today, Math.ceil(PREP_HOURS / 24)))
    .get();

  const due = await onOpenDepartures(
    snap.docs
      .map((d) => ({ ...(d.data() as Booking & { prepSentAt?: unknown }), id: d.id }))
      .filter((b) => {
        if (b.prepSentAt || !isGoing(b) || !getsAutomatedEmail(b)) return false;
        const hours = hoursUntilTour(b.date, slotStartTime(b.timeSlot, b.date), now);
        return hours <= PREP_HOURS && hours >= TOO_CLOSE_HOURS;
      }),
  );

  const baseUrl = APP_BASE_URL.value();
  return forEachBooking('Trip prep', due, (b) =>
    sendGuestOnce(b, 'prepSentAt', {
      type: 'trip-prep',
      key: `trip-prep/${b.id}/${b.date}_${b.timeSlot}`,
      ...buildTripPrepEmail({ booking: b, baseUrl }),
    }),
  );
}

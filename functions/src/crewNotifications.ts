import {
  onDocumentCreated,
  onDocumentWritten,
} from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions/v2';

import { db, FieldValue } from './lib/firebase';
import { VAPID_PRIVATE_KEY, sendCrewPush } from './lib/crew-push';
import { slotLabels } from './lib/tours';
import { marinaNow } from './lib/datetime';
import { SLOT_MINUTES, slotStartTime } from './lib/schedule';
import { isGoingAhead, type Booking, type TourTimeSlot } from './lib/types';

/**
 * Firestore trigger: pings the crew's phones when a booking becomes
 * `confirmed`. Watching the booking rather than the Stripe webhook keeps the
 * payment path untouched; a push that fails is logged and nothing else.
 *
 * Fires on every booking write and returns early unless the status just
 * changed to `confirmed`. A rare duplicate delivery replaces the first
 * notification on the phone instead of stacking, because both share a tag.
 */
export const notifyCrewOfBooking = onDocumentWritten(
  {
    document: 'bookings/{bookingId}',
    region: 'us-central1',
    secrets: [VAPID_PRIVATE_KEY],
    retry: false,
    maxInstances: 5,
  },
  async (event) => {
    const before = event.data?.before.data() as Booking | undefined;
    const after = event.data?.after.data() as Booking | undefined;
    if (!after || after.status !== 'confirmed' || before?.status === 'confirmed') {
      return;
    }

    const { bookingId } = event.params;
    // Old-site bookings arrive by the hundred from the import script, already
    // confirmed; they aren't new bookings and would flood every crew phone.
    if (bookingId.startsWith('legacy-')) return;
    try {
      const [sameDay, soloTrip] = await Promise.all([
        db
          .collection('bookings')
          .where('date', '==', after.date)
          .select('status', 'timeSlot', 'guestCount', 'legacy.bookingId')
          .get(),
        db.collection('soloTrips').doc(`${after.date}_${after.timeSlot}`).get(),
      ]);

      // Everyone going out on it, old-site reservations too.
      const going = sameDay.docs
        .map((d) => ({ ...(d.data() as Pick<Booking, 'status' | 'timeSlot' | 'guestCount' | 'legacy'>), id: d.id }))
        .filter((b) => isGoingAhead(b) && b.timeSlot === after.timeSlot);
      const onBoat = going.reduce((sum, b) => sum + (b.guestCount > 0 ? b.guestCount : 0), 0);
      // The old site didn't always record a party size: those aren't counted.
      const more = going.some((b) => !(b.guestCount > 0)) ? '+' : '';

      const when = after.timeSlot in SLOT_MINUTES
        ? formatTime(slotStartTime(after.timeSlot, after.date))
        : slotLabels[after.timeSlot];
      const guests = `${after.guestCount} ${after.guestCount === 1 ? 'guest' : 'guests'}`;
      const total = onBoat > after.guestCount || more ? ` (${onBoat}${more} on the boat)` : '';
      const noCrew = soloTrip.exists ? ' · No crew needed' : '';

      const result = await sendCrewPush({
        title: `New booking: ${formatDate(after.date)}`,
        body: `${when} · ${after.tourName} · ${guests}${total}${noCrew}`,
        url: '/crew',
        tag: `booking-${bookingId}`,
      });
      logger.info('Crew notified of booking', { bookingId, ...result });
    } catch (err) {
      logger.error('Failed to notify crew of booking', { bookingId, err });
    }
  },
);

/**
 * Firestore trigger: tells the crew's phones when Travis takes them off a
 * trip to run it solo (a `soloTrips` doc is created by `adminSetTripCrew`)
 * or puts them back on (it's deleted), so nobody turns up for nothing or
 * misses a trip. Both share a tag, so the newer one replaces the older on
 * the phone.
 */
export const notifyCrewOfSoloTrip = onDocumentWritten(
  {
    document: 'soloTrips/{tripId}',
    region: 'us-central1',
    secrets: [VAPID_PRIVATE_KEY],
    retry: false,
    maxInstances: 5,
  },
  async (event) => {
    const before = event.data?.before;
    const after = event.data?.after;
    const solo = !!after?.exists;
    if (!before || !after || before.exists === solo) return;

    const { tripId } = event.params;
    const { date, timeSlot } = (solo ? after : before).data() as {
      date: string;
      timeSlot: TourTimeSlot;
    };
    if (date < marinaNow().date || !(timeSlot in SLOT_MINUTES)) return;

    try {
      // Switched back before this ran: that write's own trigger sends the
      // message that's still true, and this one would contradict it.
      const stillSolo = (await db.collection('soloTrips').doc(tripId).get()).exists;
      if (stillSolo !== solo) return;

      const when = formatTime(slotStartTime(timeSlot, date));
      const result = await sendCrewPush(
        solo
          ? {
              title: `No crew needed: ${formatDate(date)}`,
              body: `Travis is running the ${when} trip solo.`,
              url: '/crew',
              tag: `trip-crew-${tripId}`,
            }
          : {
              title: `Crew needed again: ${formatDate(date)}`,
              body: `The ${when} trip needs crew after all.`,
              url: '/crew',
              tag: `trip-crew-${tripId}`,
            },
      );
      logger.info('Crew told about trip crew change', { tripId, solo, ...result });
    } catch (err) {
      logger.error('Failed to tell crew about trip crew change', { tripId, solo, err });
    }
  },
);

/**
 * Firestore trigger: the "Send a test" button on /crew writes a doc to
 * `crewPushTests`; this sends that crew member a test notification and
 * records how it went on the same doc.
 */
export const sendCrewTestPush = onDocumentCreated(
  {
    document: 'crewPushTests/{testId}',
    region: 'us-central1',
    secrets: [VAPID_PRIVATE_KEY],
    retry: false,
    maxInstances: 5,
  },
  async (event) => {
    const crewId = event.data?.get('crewId') as string | undefined;
    if (!event.data || !crewId) return;

    try {
      const result = await sendCrewPush(
        {
          title: 'Notifications are working',
          body: "You'll get one of these whenever a tour is booked.",
          url: '/crew',
          tag: 'crew-test',
        },
        { crewId },
      );
      await event.data.ref.update({
        ...result,
        processedAt: FieldValue.serverTimestamp(),
      });
    } catch (err) {
      logger.error('Failed to send crew test push', { crewId, err });
      await event.data.ref.update({
        error: err instanceof Error ? err.message : 'unknown',
        processedAt: FieldValue.serverTimestamp(),
      });
    }
  },
);

/** `08:00` → `8:00 AM`. */
function formatTime(hhmm: string): string {
  const [h = 0, m = 0] = hhmm.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${suffix}`;
}

/** `2026-10-18` → `Sun, Oct 18`. */
function formatDate(iso: string): string {
  const [y = 0, m = 1, d = 1] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

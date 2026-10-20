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
import { departingSoon, leavesIn } from './lib/checkout-completed';
import { closedDeparturesOn } from './lib/close-day';
import { isGoingAhead, type Booking, type TourTimeSlot } from './lib/types';

/**
 * Firestore trigger: pings the crew's phones when a booking becomes
 * `confirmed`, and when a confirmed booking moves to another date or time
 * (Travis rescheduling it, or the customer picking a new date after he
 * closed their trip), so nobody turns up for guests who've gone elsewhere.
 * Watching the booking rather than the Stripe webhook keeps the payment
 * path untouched; a push that fails is logged and nothing else.
 *
 * Fires on every booking write and returns early unless the status just
 * changed to `confirmed` or a confirmed booking's departure changed. A rare
 * duplicate delivery replaces the first notification on the phone instead
 * of stacking, because both share the booking's tag; a move's replaces the
 * booking's earlier one the same way.
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
    if (!after || after.status !== 'confirmed') return;
    const moved =
      before?.status === 'confirmed' && (before.date !== after.date || before.timeSlot !== after.timeSlot)
        ? before
        : null;
    if (before?.status === 'confirmed' && !moved) return;

    const { bookingId } = event.params;
    // Old-site bookings arrive by the hundred from the import script, already
    // confirmed; they aren't new bookings and would flood every crew phone.
    if (bookingId.startsWith('legacy-')) return;
    try {
      const [sameDay, soloTrip, closedOn] = await Promise.all([
        db
          .collection('bookings')
          .where('date', '==', after.date)
          .select('status', 'timeSlot', 'guestCount', 'legacy.bookingId')
          .get(),
        db.collection('soloTrips').doc(`${after.date}_${after.timeSlot}`).get(),
        closedDeparturesOn(db, after.date),
      ]);

      // Everyone going out on it, old-site reservations too.
      const going = sameDay.docs
        .map((d) => ({ ...(d.data() as Pick<Booking, 'status' | 'timeSlot' | 'guestCount' | 'legacy'>), id: d.id }))
        .filter((b) => isGoingAhead(b) && b.timeSlot === after.timeSlot);
      const onBoat = going.reduce((sum, b) => sum + (b.guestCount > 0 ? b.guestCount : 0), 0);
      // The old site didn't always record a party size: those aren't counted.
      const more = going.some((b) => !(b.guestCount > 0)) ? '+' : '';

      const when = departs(after);
      const guests = `${after.guestCount} ${after.guestCount === 1 ? 'guest' : 'guests'}`;
      const total = onBoat > after.guestCount || more ? ` (${onBoat}${more} on the boat)` : '';
      const noCrew = soloTrip.exists ? ' · No crew needed' : '';
      // Paid inside the online cutoff (the checkout started before it
      // closed): the trip is about to go, so say so first. Unless Travis
      // closed the trip while they were paying (a blackout covers it): it
      // isn't going as booked, and that comes first instead.
      const soon = departingSoon(after);
      const lead = closedOn(after.timeSlot)
        ? 'On a trip Travis closed: '
        : soon
          ? `${leavesIn(soon.minutesToGo)} · `
          : '';

      const result = await sendCrewPush({
        title: moved ? `Booking moved: ${formatDate(after.date)}` : `New booking: ${formatDate(after.date)}`,
        body:
          `${lead}${when} · ${after.tourName} · ${guests}${total}${noCrew}` +
          (moved ? ` · Was ${formatDate(moved.date)}, ${departs(moved)}` : ''),
        url: '/crew',
        tag: `booking-${bookingId}`,
      });
      logger.info(moved ? 'Crew told of booking move' : 'Crew notified of booking', { bookingId, ...result });
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

/** When the booking's departure leaves, `8:00 AM` (the sunset cruise's on its day). */
function departs(b: Pick<Booking, 'date' | 'timeSlot'>): string {
  return b.timeSlot in SLOT_MINUTES ? formatTime(slotStartTime(b.timeSlot, b.date)) : slotLabels[b.timeSlot];
}

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

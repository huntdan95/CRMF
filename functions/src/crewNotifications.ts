import {
  onDocumentCreated,
  onDocumentWritten,
} from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions/v2';

import { db, FieldValue } from './lib/firebase';
import { VAPID_PRIVATE_KEY, sendCrewPush } from './lib/crew-push';
import { getTourBySlug, slotLabels } from './lib/tours';
import type { Booking } from './lib/types';

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
    try {
      const [tour, sameDay] = await Promise.all([
        getTourBySlug(after.tourId),
        db
          .collection('bookings')
          .where('date', '==', after.date)
          .select('status', 'timeSlot', 'guestCount')
          .get(),
      ]);

      const onBoat = sameDay.docs
        .map((d) => d.data() as Pick<Booking, 'status' | 'timeSlot' | 'guestCount'>)
        .filter((b) => b.status === 'confirmed' && b.timeSlot === after.timeSlot)
        .reduce((sum, b) => sum + (b.guestCount ?? 0), 0);

      const when = tour ? formatTime(tour.startTime) : slotLabels[after.timeSlot];
      const guests = `${after.guestCount} ${after.guestCount === 1 ? 'guest' : 'guests'}`;
      const total = onBoat > after.guestCount ? ` (${onBoat} on the boat)` : '';

      const result = await sendCrewPush({
        title: `New booking: ${formatDate(after.date)}`,
        body: `${when} · ${after.tourName} · ${guests}${total}`,
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

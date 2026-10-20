import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';

import { db, FieldValue, Timestamp } from './lib/firebase';
import { RESEND_API_KEY, RESEND_FROM_EMAIL } from './lib/resend';
import { APP_BASE_URL } from './lib/config';
import { marinaNow } from './lib/datetime';
import { notifyCrew, type Message } from './lib/notify';
import { getAutomationSettings } from './lib/site-settings';
import { closedDeparturesOn } from './lib/close-day';
import {
  buildCrewBookingAlert,
  buildCrewCancellationAlert,
  buildCrewRescheduleAlert,
} from './lib/crew-templates';
import { isGoingAhead, type Booking, type TourTimeSlot } from './lib/types';

/*
 * Instant emails to the crew (everyone in Admin → Crew with crew emails
 * on) when a tour is booked, a customer cancels, or a customer asks to
 * move their tour.
 *
 * Each is sent once. The marker is `crewAlertSentAt.<event>` on the
 * booking (`booked`, `cancelled`), or `crewAlertSentAt` on the reschedule
 * request, since one booking can have several requests over time. If the
 * send fails it's left unset, and {@link retryCrewAlerts} tries again
 * within the hour.
 */

export type BookingAlertEvent = 'booked' | 'cancelled';

type AlertMarkers = { crewAlertSentAt?: Partial<Record<BookingAlertEvent, unknown>> };

/**
 * Each party's guestCount on a departure (0: an old-site booking with no
 * party size on file): everyone going out on it, old-site reservations
 * too (and completed bookings, after it ran), as the crew app counts them.
 * Not those asked to pick a new date after Travis closed it.
 */
async function guestsOnDeparture(date: string, timeSlot: TourTimeSlot): Promise<number[]> {
  const snap = await db
    .collection('bookings')
    .where('date', '==', date)
    .select('status', 'timeSlot', 'guestCount', 'legacy.bookingId', 'closure.blackoutId')
    .get();
  return snap.docs
    .map((d) => ({ ...(d.data() as Pick<Booking, 'status' | 'timeSlot' | 'guestCount' | 'legacy' | 'closure'>), id: d.id }))
    .filter((b) => b.timeSlot === timeSlot && (isGoingAhead(b) || b.status === 'completed') && !b.closure)
    .map((b) => b.guestCount ?? 0);
}

/**
 * Sends the message and records the marker. Marked when at least one crew
 * member got it, or when nobody has crew emails on (so a crew member added
 * next week isn't sent last week's news). Left unmarked only if every send
 * failed.
 */
async function sendAndMark(
  message: Message,
  mark: (ts: FirebaseFirestore.FieldValue) => Promise<unknown>,
): Promise<'sent' | 'no-crew' | 'failed'> {
  const result = await notifyCrew(message);
  if (result.sent === 0 && result.failed > 0) return 'failed';
  await mark(FieldValue.serverTimestamp());
  return result.sent > 0 ? 'sent' : 'no-crew';
}

/**
 * "New booking" to the crew. Called by stripeWebhook once a booking is
 * confirmed (after the customer's confirmation), and by the hourly retry.
 * Safe to call more than once.
 */
export async function alertCrewOfBooking(bookingId: string): Promise<string> {
  const ref = db.collection('bookings').doc(bookingId);
  const booking = (await ref.get()).data() as (Booking & AlertMarkers) | undefined;
  if (!booking) return 'not-found';
  if (booking.crewAlertSentAt?.booked) return 'already-sent';
  if (booking.status !== 'confirmed') return 'not-confirmed';
  // Old-site bookings arrive by the hundred from the import script; they
  // aren't new bookings.
  if (bookingId.startsWith('legacy-')) return 'imported';
  if (booking.date < marinaNow().date) return 'past';

  const [settings, boat, closedOn] = await Promise.all([
    getAutomationSettings(),
    guestsOnDeparture(booking.date, booking.timeSlot).catch(() => null),
    closedDeparturesOn(db, booking.date),
  ]);
  const email = buildCrewBookingAlert({
    booking,
    baseUrl: APP_BASE_URL.value(),
    sizes: settings.wetsuitSizes,
    boat,
    // Paid after Travis closed it: marked, as the crew push marks it.
    closedTrip: !!booking.closure || closedOn(booking.timeSlot),
  });
  return sendAndMark(
    { type: 'crew-new-booking', key: `crew-booked/${bookingId}`, refId: bookingId, ...email },
    (ts) => ref.update({ 'crewAlertSentAt.booked': ts }),
  );
}

/**
 * "Cancelled" to the crew, for a confirmed booking the customer cancelled
 * online. Called by cancelBooking, and by the hourly retry.
 */
export async function alertCrewOfCancellation(bookingId: string): Promise<string> {
  const ref = db.collection('bookings').doc(bookingId);
  const booking = (await ref.get()).data() as (Booking & AlertMarkers) | undefined;
  if (!booking) return 'not-found';
  if (booking.crewAlertSentAt?.cancelled) return 'already-sent';
  if (booking.status !== 'cancelled' || booking.cancelledBy !== 'customer') return 'not-cancelled';
  // Only bookings that were paid for (and so on the crew's list) count.
  if (!booking.amountPaidCents) return 'never-confirmed';
  if (booking.date < marinaNow().date) return 'past';

  const stillOnBoat = await guestsOnDeparture(booking.date, booking.timeSlot).catch(() => null);
  const email = buildCrewCancellationAlert({
    booking,
    baseUrl: APP_BASE_URL.value(),
    // This cancellation's refund, not any Travis gave before it. A booking
    // cancelled before the field existed has only the total.
    refundCents: booking.cancelRefundCents ?? booking.amountRefundedCents ?? 0,
    stillOnBoat,
  });
  return sendAndMark(
    { type: 'crew-cancellation', key: `crew-cancelled/${bookingId}`, refId: bookingId, ...email },
    (ts) => ref.update({ 'crewAlertSentAt.cancelled': ts }),
  );
}

interface RescheduleRequestDoc {
  bookingId: string;
  requestedDate: string;
  requestedSlot: TourTimeSlot | null;
  notes: string | null;
  status: string;
  crewAlertSentAt?: unknown;
}

/** "Reschedule request" to the crew. Called by requestReschedule, and by the hourly retry. */
export async function alertCrewOfRescheduleRequest(requestId: string): Promise<string> {
  const ref = db.collection('rescheduleRequests').doc(requestId);
  const request = (await ref.get()).data() as RescheduleRequestDoc | undefined;
  if (!request) return 'not-found';
  if (request.crewAlertSentAt) return 'already-sent';
  if (request.status !== 'open') return 'not-open';
  const booking = (await db.collection('bookings').doc(request.bookingId).get()).data() as
    | Booking
    | undefined;
  if (!booking) return 'no-booking';

  const email = buildCrewRescheduleAlert({
    booking,
    baseUrl: APP_BASE_URL.value(),
    requestedDate: request.requestedDate,
    requestedSlot: request.requestedSlot,
    notes: request.notes,
  });
  return sendAndMark(
    {
      type: 'crew-reschedule-request',
      key: `crew-reschedule/${requestId}`,
      refId: request.bookingId,
      ...email,
    },
    (ts) => ref.update({ crewAlertSentAt: ts }),
  );
}

/** How far back the hourly retry looks for alerts that didn't go out. */
const RETRY_WINDOW_MS = 3 * 60 * 60 * 1000;

/**
 * Hourly: sends any crew alert from the last few hours that failed the
 * first time (Resend down, say). Each one is tried on its own, so one
 * failure doesn't stop the rest.
 */
export const retryCrewAlerts = onSchedule(
  {
    schedule: 'every 60 minutes',
    timeZone: 'America/New_York',
    region: 'us-central1',
    secrets: [RESEND_API_KEY, RESEND_FROM_EMAIL, APP_BASE_URL],
    retryCount: 0,
  },
  async () => {
    await runCrewAlertRetry(new Date());
  },
);

export async function runCrewAlertRetry(now: Date): Promise<void> {
  const since = Timestamp.fromMillis(now.getTime() - RETRY_WINDOW_MS);
  const [created, cancelled, requests] = await Promise.all([
    db.collection('bookings').where('createdAt', '>=', since).get(),
    db.collection('bookings').where('cancelledAt', '>=', since).get(),
    db.collection('rescheduleRequests').where('createdAt', '>=', since).get(),
  ]);

  const jobs: Array<[string, string, () => Promise<string>]> = [
    ...created.docs
      .filter((d) => {
        const b = d.data() as Booking & AlertMarkers;
        return b.status === 'confirmed' && !d.id.startsWith('legacy-') && !b.crewAlertSentAt?.booked;
      })
      .map((d): [string, string, () => Promise<string>] => ['booked', d.id, () => alertCrewOfBooking(d.id)]),
    ...cancelled.docs
      .filter((d) => {
        const b = d.data() as Booking & AlertMarkers;
        return b.cancelledBy === 'customer' && !!b.amountPaidCents && !b.crewAlertSentAt?.cancelled;
      })
      .map((d): [string, string, () => Promise<string>] => ['cancelled', d.id, () => alertCrewOfCancellation(d.id)]),
    ...requests.docs
      .filter((d) => d.get('status') === 'open' && !d.get('crewAlertSentAt'))
      .map((d): [string, string, () => Promise<string>] => ['reschedule', d.id, () => alertCrewOfRescheduleRequest(d.id)]),
  ];

  for (const [event, id, run] of jobs) {
    try {
      const outcome = await run();
      logger.info('Crew alert retry', { event, id, outcome });
    } catch (err) {
      logger.error('Crew alert retry failed', { event, id, err });
    }
  }
}

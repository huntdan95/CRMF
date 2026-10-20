import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';

import { db, FieldValue, Timestamp } from './lib/firebase';
import { RESEND_API_KEY, RESEND_FROM_EMAIL } from './lib/resend';
import { APP_BASE_URL } from './lib/config';
import { marinaNow } from './lib/datetime';
import { notifyCrew, notifyOwner, type Message } from './lib/notify';
import { getAutomationSettings } from './lib/site-settings';
import { closedDeparturesOn } from './lib/close-day';
import {
  buildCrewBookingAlert,
  buildCrewCancellationAlert,
  buildCrewRescheduleAlert,
} from './lib/crew-templates';
import { buildCrewNotToldEmail } from './lib/owner-templates';
import { isGoingAhead, type Booking, type TourTimeSlot } from './lib/types';
import { retryRefundRefusedAlerts } from './cancelBooking';

/*
 * Instant emails to the crew (everyone in Admin → Crew with crew emails
 * on) when a tour is booked, a customer cancels, or a customer asks to
 * move their tour.
 *
 * Each is sent once. The marker is `crewAlertSentAt.<event>` on the
 * booking (`booked`, `cancelled`), or `crewAlertSentAt` on the reschedule
 * request, since one booking can have several requests over time. If the
 * send fails it's left unset, and {@link retryCrewAlerts} tries again
 * within the hour. A cancellation it still can't send when it gives up is
 * Travis's to pass on: he's emailed, once (`crewAlertMissedAt.cancelled`).
 */

export type BookingAlertEvent = 'booked' | 'cancelled';

type AlertMarkers = {
  crewAlertSentAt?: Partial<Record<BookingAlertEvent, unknown>>;
  /** When Travis was told the alert never reached the crew. */
  crewAlertMissedAt?: Partial<Record<BookingAlertEvent, unknown>>;
};

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

  const [settings, boat, closedOn, soloTrip] = await Promise.all([
    getAutomationSettings(),
    guestsOnDeparture(booking.date, booking.timeSlot).catch(() => null),
    closedDeparturesOn(db, booking.date),
    db.collection('soloTrips').doc(`${booking.date}_${booking.timeSlot}`).get(),
  ]);
  const email = buildCrewBookingAlert({
    booking,
    baseUrl: APP_BASE_URL.value(),
    sizes: settings.wetsuitSizes,
    boat,
    // Paid after Travis closed it: marked, as the crew push marks it.
    closedTrip: !!booking.closure || closedOn(booking.timeSlot),
    // Running it solo: the push and the 8 PM email say so, and a mate who
    // only gets the emails shouldn't turn up for it.
    noCrew: soloTrip.exists,
  });
  return sendAndMark(
    { type: 'crew-new-booking', key: `crew-booked/${bookingId}`, refId: bookingId, ...email },
    (ts) => ref.update({ 'crewAlertSentAt.booked': ts }),
  );
}

/**
 * "Cancelled" to the crew, for a confirmed booking the customer cancelled
 * online. Called by cancelBooking, and by the hourly retry. Not when they
 * took the refund after Travis closed their trip.
 */
export async function alertCrewOfCancellation(bookingId: string): Promise<string> {
  const ref = db.collection('bookings').doc(bookingId);
  const booking = (await ref.get()).data() as (Booking & AlertMarkers) | undefined;
  if (!booking) return 'not-found';
  if (booking.crewAlertSentAt?.cancelled) return 'already-sent';
  if (booking.status !== 'cancelled' || booking.cancelledBy !== 'customer') return 'not-cancelled';
  // Only bookings that were paid for (and so on the crew's list) count.
  if (!booking.amountPaidCents) return 'never-confirmed';
  // They took the refund Travis offered when he closed their trip: off the
  // crew's list since then, and the closure's own alert told them.
  if (booking.closure) return 'closed';
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
  // Only a trip on the crew's list (requestReschedule turns the rest away;
  // this covers requests made before it did).
  if (!isGoingAhead({ ...booking, id: request.bookingId })) return 'not-going-ahead';

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
/** How often it runs. */
const RUN_EVERY_MS = 60 * 60 * 1000;
/** Leeway for a run that starts a little late, when telling the last try. */
const LAST_TRY_SLACK_MS = 5 * 60 * 1000;

/**
 * Hourly: sends any crew alert from the last few hours that failed the
 * first time (Resend down, say). Each one is tried on its own, so one
 * failure doesn't stop the rest. A customer's cancellation still failing
 * on its last try is emailed to Travis instead: for the crew it's the only
 * word of it, since the 8 PM schedule just leaves the booking out. Also
 * sends Travis any "Refund refused" alert that failed
 * (retryRefundRefusedAlerts).
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
  // Cancelled before this, the next run (an hour on, give or take) may be
  // past it: this is its last try.
  const lastTryBefore = now.getTime() + RUN_EVERY_MS + LAST_TRY_SLACK_MS - RETRY_WINDOW_MS;
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
        return (
          b.cancelledBy === 'customer' &&
          !!b.amountPaidCents &&
          !b.closure &&
          !b.crewAlertSentAt?.cancelled &&
          !b.crewAlertMissedAt?.cancelled
        );
      })
      .map((d): [string, string, () => Promise<string>] => ['cancelled', d.id, () => alertCrewOfCancellation(d.id)]),
    ...requests.docs
      .filter((d) => d.get('status') === 'open' && !d.get('crewAlertSentAt'))
      .map((d): [string, string, () => Promise<string>] => ['reschedule', d.id, () => alertCrewOfRescheduleRequest(d.id)]),
  ];

  const failed = new Set<string>();
  for (const [event, id, run] of jobs) {
    try {
      const outcome = await run();
      logger.info('Crew alert retry', { event, id, outcome });
      if (outcome === 'failed') failed.add(`${event}/${id}`);
    } catch (err) {
      failed.add(`${event}/${id}`);
      logger.error('Crew alert retry failed', { event, id, err });
    }
  }

  for (const d of cancelled.docs) {
    const cancelledAt = (d.data() as { cancelledAt?: Timestamp }).cancelledAt;
    if (!failed.has(`cancelled/${d.id}`) || !cancelledAt || cancelledAt.toMillis() >= lastTryBefore) continue;
    try {
      await alertOwnerOfMissedCancellation(d.id);
    } catch (err) {
      logger.error('Telling Travis the crew missed a cancellation failed', { id: d.id, err });
    }
  }

  await retryRefundRefusedAlerts().catch((err) => logger.error('Refund-refused alert retry failed', { err }));
}

/**
 * Emails Travis that the crew were never told of a customer's
 * cancellation, and records it (`crewAlertMissedAt.cancelled`) so it goes
 * once and the retries stop: passing it on is his now.
 */
async function alertOwnerOfMissedCancellation(bookingId: string): Promise<void> {
  const ref = db.collection('bookings').doc(bookingId);
  const booking = { ...((await ref.get()).data() as Booking & AlertMarkers), id: bookingId };
  if (booking.crewAlertSentAt?.cancelled || booking.crewAlertMissedAt?.cancelled) return;
  await notifyOwner({
    type: 'crew-not-told',
    key: `crew-not-told/${bookingId}`,
    refId: bookingId,
    ...buildCrewNotToldEmail({ booking, baseUrl: APP_BASE_URL.value() }),
  });
  await ref.update({ 'crewAlertMissedAt.cancelled': FieldValue.serverTimestamp() });
}

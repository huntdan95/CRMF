import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';

import { db, FieldValue } from './lib/firebase';
import { RESEND_API_KEY, RESEND_FROM_EMAIL } from './lib/resend';
import { APP_BASE_URL } from './lib/config';
import { addDays, marinaNow } from './lib/datetime';
import { notifyCrew } from './lib/notify';
import { closedDeparturesOn, closurePendingFor } from './lib/close-day';
import { getAutomationSettings } from './lib/site-settings';
import { buildCrewSchedule, type ScheduleTrip } from './lib/crew-templates';
import { departureMinutes } from './lib/trip-format';
import { ensureUploadToken, uploadUrl } from './lib/trip-photos';
import { isGoingAhead, type Booking, type TourTimeSlot } from './lib/types';

/*
 * 8:00 PM ET: tomorrow's trips to every crew member with crew emails on,
 * in time order, each with its photo-upload link. Nothing is sent when
 * there are no trips tomorrow; a booking made after it goes out reaches the
 * crew as a new-booking alert.
 *
 * Everyone going out counts, as in the crew app: old-site reservations,
 * and a booking Travis refunded in full but left on the trip. Not those
 * asked to pick a new date after he closed their trip. A departure a
 * blackout covers is listed but marked, Closed (he left them booked to
 * contact them) or Being called off (the undo window is open), with no
 * upload link; one he's running solo says No crew needed.
 *
 * It's one email per evening, so the guard against sending it twice is
 * `crewSchedules/{date}.sentAt`. Each booking it listed also gets
 * `crewScheduleSentAt`.
 */
export const sendCrewSchedule = onSchedule(
  {
    schedule: 'every day 20:00',
    timeZone: 'America/New_York',
    region: 'us-central1',
    secrets: [RESEND_API_KEY, RESEND_FROM_EMAIL, APP_BASE_URL],
    retryCount: 0,
  },
  async () => {
    await runCrewSchedule(new Date());
  },
);

export async function runCrewSchedule(now: Date): Promise<string> {
  const date = addDays(marinaNow(now).date, 1);
  const runRef = db.collection('crewSchedules').doc(date);
  if ((await runRef.get()).get('sentAt')) return 'already-sent';

  const [snap, closed] = await Promise.all([
    db.collection('bookings').where('date', '==', date).get(),
    closedDeparturesOn(db, date),
  ]);
  const bookings = snap.docs
    .map((d) => ({ ...(d.data() as Booking), id: d.id }))
    .filter((b) => isGoingAhead(b) && !b.closure);
  if (bookings.length === 0) {
    logger.info('No trips tomorrow; no crew schedule sent', { date });
    return 'no-trips';
  }

  const bySlot = new Map<TourTimeSlot, Booking[]>();
  for (const b of bookings) {
    bySlot.set(b.timeSlot, [...(bySlot.get(b.timeSlot) ?? []), b]);
  }
  const trips: ScheduleTrip[] = [...bySlot.entries()]
    .sort(([a], [b]) => departureMinutes(a, date) - departureMinutes(b, date))
    .map(([timeSlot, list]) => ({
      timeSlot,
      bookings: list.sort((a, b) => (a.createdAt?.toMillis?.() ?? 0) - (b.createdAt?.toMillis?.() ?? 0)),
    }));

  for (const trip of trips) {
    if (closed(trip.timeSlot)) {
      trip.off = (await closurePendingFor(db, date, trip.timeSlot)) ? 'closing' : 'closed';
    }
    trip.noCrew = (await db.collection('soloTrips').doc(`${date}_${trip.timeSlot}`).get()).exists;
  }

  // Each departure's photo-upload link. The email still goes without one.
  const baseUrl = APP_BASE_URL.value();
  for (const trip of trips) {
    if (trip.off) continue;
    try {
      trip.uploadUrl = uploadUrl(baseUrl, (await ensureUploadToken(date, trip.timeSlot)).token);
    } catch (err) {
      logger.error('Could not make a trip upload link', { date, timeSlot: trip.timeSlot, err });
    }
  }

  const settings = await getAutomationSettings();
  const email = buildCrewSchedule({ date, trips, baseUrl, sizes: settings.wetsuitSizes });
  const result = await notifyCrew({ type: 'crew-schedule', key: `crew-schedule/${date}`, ...email });
  if (result.sent === 0 && result.failed > 0) {
    logger.error('Crew schedule failed for every crew member', { date });
    return 'failed';
  }

  const batch = db.batch();
  const going = trips.filter((t) => !t.off);
  batch.set(runRef, {
    date,
    sentAt: FieldValue.serverTimestamp(),
    trips: going.length,
    closedTrips: trips.length - going.length,
    guests: going.reduce((s, t) => s + t.bookings.reduce((n, b) => n + Math.max(0, b.guestCount), 0), 0),
    crewSent: result.sent,
    crewFailed: result.failed,
  });
  for (const b of bookings) {
    batch.update(db.collection('bookings').doc(b.id), { crewScheduleSentAt: FieldValue.serverTimestamp() });
  }
  await batch.commit();
  return result.sent > 0 ? 'sent' : 'no-crew';
}

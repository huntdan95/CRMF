import 'server-only';
import { adminDb } from './firebase/admin';
import { tours, type MarketingTour } from './tours';
import {
  computeRange,
  marinaNow,
  tourStatus,
  type BlackoutLite,
  type BookingLite,
  type DayAvailability,
} from './availability';

/** Longest range one request may ask for (two calendar months, roughly). */
export const MAX_RANGE_DAYS = 62;

const READ_TIMEOUT_MS = 4000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Firestore read timed out')), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/**
 * Per-day availability for every date in [from, to], read straight from
 * Firestore with the Admin SDK. Only the five fields availability needs
 * are fetched — no names, emails, or phone numbers leave Firestore.
 *
 * Returns null if Firestore can't be reached (e.g. local dev without a
 * service account); callers fall back to the Cloud Function.
 */
export async function fetchAvailabilityRange(
  from: string,
  to: string,
): Promise<DayAvailability[] | null> {
  try {
    const db = adminDb();
    const [bookingsSnap, blackoutsSnap] = await withTimeout(
      Promise.all([
        db
          .collection('bookings')
          .where('date', '>=', from)
          .where('date', '<=', to)
          .select('date', 'timeSlot', 'type', 'guestCount', 'status')
          .get(),
        db
          .collection('blackouts')
          .where('date', '>=', from)
          .where('date', '<=', to)
          .select('date', 'affectedSlots')
          .get(),
      ]),
      READ_TIMEOUT_MS,
    );
    const bookings = bookingsSnap.docs.map((d) => d.data() as BookingLite);
    const blackouts = blackoutsSnap.docs.map((d) => d.data() as BlackoutLite);
    return computeRange(from, to, bookings, blackouts);
  } catch {
    return null;
  }
}

export interface UpcomingDeparture {
  date: string;
  /** The two-hour slot's shared and private tours. */
  shared: MarketingTour;
  private: MarketingTour;
  /** Open shared seats (0 = shared tour sold out or the boat went private). */
  seatsLeft: number;
  privateOpen: boolean;
}

/**
 * The next few two-hour departures that can still be booked, soonest
 * first, for the home page's departures board. Null when Firestore can't
 * be reached, so the caller can show the plain schedule instead.
 */
export async function upcomingDepartures({
  days = 14,
  limit = 6,
}: { days?: number; limit?: number } = {}): Promise<UpcomingDeparture[] | null> {
  const now = marinaNow();
  const range = await fetchAvailabilityRange(now.date, addDays(now.date, days - 1));
  if (!range) return null;
  const out: UpcomingDeparture[] = [];
  for (const day of range) {
    for (const slot of day.slots) {
      if (slot.timeSlot === 'whole-day' || slot.closed || slot.departed) continue;
      if (slot.sharedRemaining === 0 && !slot.privateAvailable) continue;
      const shared = tours.find((t) => t.timeSlot === slot.timeSlot && t.type === 'shared');
      const priv = tours.find((t) => t.timeSlot === slot.timeSlot && t.type === 'private');
      if (!shared?.active || !priv?.active) continue;
      out.push({
        date: day.date,
        shared,
        private: priv,
        seatsLeft: slot.sharedRemaining,
        privateOpen: slot.privateAvailable,
      });
      if (out.length >= limit) return out;
    }
  }
  return out;
}

function addDays(iso: string, n: number) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + n)).toISOString().slice(0, 10);
}

/**
 * The next dates a specific tour can be booked (for at least one guest),
 * for the quick-pick dates on its tour page. Null if Firestore is
 * unreachable.
 */
export async function nextOpenDates(
  tour: MarketingTour,
  { days = 30, limit = 6 }: { days?: number; limit?: number } = {},
): Promise<Array<{ date: string; seatsLeft: number | null }> | null> {
  const now = marinaNow();
  const range = await fetchAvailabilityRange(now.date, addDays(now.date, days - 1));
  if (!range) return null;
  const out: Array<{ date: string; seatsLeft: number | null }> = [];
  for (const day of range) {
    const status = tourStatus(tour, day, 1);
    if (!status.bookable) continue;
    out.push({ date: day.date, seatsLeft: status.seatsLeft });
    if (out.length >= limit) break;
  }
  return out;
}

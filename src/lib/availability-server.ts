import 'server-only';
import { adminDb } from './firebase/admin';
import {
  computeRange,
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

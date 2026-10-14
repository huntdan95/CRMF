import type { Transaction } from 'firebase-admin/firestore';
import { db } from './firebase';
import {
  BOOKING_WINDOW_DAYS,
  addDays,
  departureClosed,
  isRealDate,
  marinaNow,
  type MarinaClock,
} from './datetime';
import type {
  Blackout,
  Booking,
  Tour,
  TourTimeSlot,
} from './types';

/**
 * Active bookings as far as availability is concerned. Cancelled / no-show
 * bookings free their slot for re-booking.
 */
const ACTIVE_STATUSES = ['pending-payment', 'confirmed'] as const;

/**
 * Two-hour departures that run during the whole-day charter (7:00–15:00),
 * so a blackout on any of them rules out the charter too. Mirrors
 * WHOLE_DAY_OVERLAPS in the website's src/lib/availability.ts.
 * Late-afternoon leaves at 15:30, after the charter is back.
 */
export const WHOLE_DAY_OVERLAPS: readonly TourTimeSlot[] = [
  'morning',
  'mid-morning',
  'early-afternoon',
];

export class AvailabilityError extends Error {
  constructor(
    public readonly reason: AvailabilityReason,
    message: string,
  ) {
    super(message);
    this.name = 'AvailabilityError';
  }
}

export type AvailabilityReason =
  | 'invalid-date'
  | 'departed'
  | 'too-far-ahead'
  | 'blackout-day'
  | 'blackout-slot'
  | 'whole-day-booked'
  | 'slot-private-booked'
  | 'slot-private-conflict'
  | 'slot-shared-full'
  | 'invalid-guest-count';

/**
 * Looks up the active bookings + blackouts for a given date and checks whether
 * a new booking of the given tour + guestCount is allowed.
 *
 * Pass either an existing `Transaction` (to roll the check into a write txn)
 * or omit it for a stand-alone read (used by the slot-picker page to show
 * live availability).
 *
 * The date and clock rules ({@link assertBookingWindow}) run before any
 * reads, then guestCount must be in [1, maxGuests], then the seat rules
 * ({@link assertSeatsAvailable}).
 */
export async function checkAvailability(opts: {
  tour: Tour;
  date: string;
  guestCount: number;
  tx?: Transaction;
  /** The marina clock. Defaults to now. */
  now?: MarinaClock;
}): Promise<{ existingBookings: Booking[]; blackouts: Blackout[] }> {
  const { tour, date, guestCount, tx, now = marinaNow() } = opts;

  assertBookingWindow({ tour, date, now });

  if (guestCount < 1 || guestCount > tour.maxGuests) {
    throw new AvailabilityError(
      'invalid-guest-count',
      `Guest count must be between 1 and ${tour.maxGuests}.`,
    );
  }

  const bookingsQuery = db.collection('bookings').where('date', '==', date);
  const blackoutsQuery = db.collection('blackouts').where('date', '==', date);

  const [bookingsSnap, blackoutsSnap] = tx
    ? await Promise.all([tx.get(bookingsQuery), tx.get(blackoutsQuery)])
    : await Promise.all([bookingsQuery.get(), blackoutsQuery.get()]);

  const allBookings = bookingsSnap.docs.map((d) => d.data() as Booking);
  const blackouts = blackoutsSnap.docs.map((d) => d.data() as Blackout);

  const existingBookings = assertSeatsAvailable({
    tour,
    date,
    guestCount,
    bookings: allBookings,
    blackouts,
  });
  return { existingBookings, blackouts };
}

/**
 * Can this departure still be booked online at all? The limits the website
 * applies, enforced here so a stale page or a hand-built request can't get
 * past them:
 *  - the date is a real calendar date (no 2026-11-31),
 *  - the departure hasn't left and doesn't leave within the online cutoff,
 *    on America/New_York time,
 *  - the date is no more than {@link BOOKING_WINDOW_DAYS} days out.
 */
export function assertBookingWindow(opts: {
  tour: Pick<Tour, 'startTime'>;
  date: string;
  now: MarinaClock;
}): void {
  const { tour, date, now } = opts;

  if (!isRealDate(date)) {
    throw new AvailabilityError(
      'invalid-date',
      `${date} isn't a date on the calendar.`,
    );
  }
  if (departureClosed(date, tour.startTime, now)) {
    throw new AvailabilityError(
      'departed',
      `Online booking for the ${tour.startTime} departure on ${date} has closed.`,
    );
  }
  const lastDate = addDays(now.date, BOOKING_WINDOW_DAYS);
  if (date > lastDate) {
    throw new AvailabilityError(
      'too-far-ahead',
      `Online booking is open through ${lastDate}.`,
    );
  }
}

/**
 * Seat rules for one date, given every booking and blackout on it. Returns
 * the active bookings in the requested slot.
 *
 * Rules (mirror src/lib/firebase/types.ts and the rebuild-plan spec):
 *  1. If a blackout covers the whole day (`'all'`) or the requested slot → reject.
 *     A whole-day charter is also rejected when a blackout covers any
 *     departure inside its hours ({@link WHOLE_DAY_OVERLAPS}).
 *  2. If a whole-day-private booking exists on that date → reject all other slots.
 *  3. If a private booking exists for the same slot → reject any new booking.
 *  4. If a new booking is private and any shared booking exists for the slot → reject.
 *  5. For shared bookings → existing guest count + new guest count must be ≤ maxGuests.
 */
export function assertSeatsAvailable(opts: {
  tour: Pick<Tour, 'timeSlot' | 'type' | 'maxGuests'>;
  date: string;
  guestCount: number;
  bookings: Booking[];
  blackouts: Blackout[];
}): Booking[] {
  const { tour, date, guestCount, bookings, blackouts } = opts;

  // Filter to only the bookings that occupy a slot.
  const activeBookings = bookings.filter((b) =>
    (ACTIVE_STATUSES as readonly string[]).includes(b.status),
  );

  // Rule 1: blackout for the day or this slot.
  for (const bo of blackouts) {
    if (bo.affectedSlots.includes('all')) {
      throw new AvailabilityError(
        'blackout-day',
        `${date} is blacked out${bo.reason ? ` (${bo.reason})` : ''}.`,
      );
    }
    if (bo.affectedSlots.includes(tour.timeSlot)) {
      throw new AvailabilityError(
        'blackout-slot',
        `The ${tour.timeSlot} slot is blacked out for ${date}${bo.reason ? ` (${bo.reason})` : ''}.`,
      );
    }
    const overlap = tour.timeSlot === 'whole-day'
      ? WHOLE_DAY_OVERLAPS.find((slot) => bo.affectedSlots.includes(slot))
      : undefined;
    if (overlap) {
      throw new AvailabilityError(
        'blackout-slot',
        `The ${overlap} slot is blacked out for ${date}${bo.reason ? ` (${bo.reason})` : ''}, so the whole-day charter can't run.`,
      );
    }
  }

  // Rule 2: any whole-day private booking blocks every other slot, AND blocks
  // any further whole-day booking.
  const wholeDay = activeBookings.find((b) => b.timeSlot === 'whole-day');
  if (wholeDay) {
    throw new AvailabilityError(
      'whole-day-booked',
      `${date} is booked for a whole-day private tour — no other slots available.`,
    );
  }

  // Rule 2b: if the new booking is a whole-day, reject if ANY other booking
  // exists that day.
  if (tour.timeSlot === 'whole-day' && activeBookings.length > 0) {
    throw new AvailabilityError(
      'whole-day-booked',
      `${date} already has bookings — whole-day private tours need an empty calendar.`,
    );
  }

  // Now consider bookings in this specific slot.
  const slotBookings = activeBookings.filter(
    (b) => b.timeSlot === tour.timeSlot,
  );

  // Rule 3: existing private booking blocks the slot entirely.
  const existingPrivate = slotBookings.find((b) => b.type === 'private');
  if (existingPrivate) {
    throw new AvailabilityError(
      'slot-private-booked',
      `The ${tour.timeSlot} slot is already booked as a private tour for ${date}.`,
    );
  }

  // Rule 4: new private booking + existing shared booking = conflict.
  if (tour.type === 'private' && slotBookings.length > 0) {
    throw new AvailabilityError(
      'slot-private-conflict',
      `Can't book the ${tour.timeSlot} slot privately — shared bookings already exist for ${date}.`,
    );
  }

  // Rule 5: shared capacity. A booking imported from the old site with no
  // recorded party size (guestCount 0) counts as filling the boat until
  // Travis sets its size; counting it as zero would sell its seats again.
  if (tour.type === 'shared') {
    const used = slotBookings.reduce(
      (sum, b) => sum + (b.guestCount >= 1 ? b.guestCount : tour.maxGuests),
      0,
    );
    if (used + guestCount > tour.maxGuests) {
      throw new AvailabilityError(
        'slot-shared-full',
        `Only ${Math.max(0, tour.maxGuests - used)} of ${tour.maxGuests} spots remain for the ${tour.timeSlot} tour on ${date}.`,
      );
    }
  }

  return slotBookings;
}

/** Per-slot snapshot used by the public slot-picker page. */
export interface SlotAvailability {
  timeSlot: TourTimeSlot;
  /** Spots remaining for shared bookings. `0` once private is booked or capacity hit. */
  sharedRemaining: number;
  /** Whether a private booking is still possible. */
  privateAvailable: boolean;
  /** True if the day is blacked out (whole day or this slot). */
  blackedOut: boolean;
  /** True if the whole day is taken by a whole-day-private booking. */
  wholeDayBooked: boolean;
}

/**
 * Public read used by the slot-picker page (`/book/[date]`). Computes the
 * available remaining capacity for every slot on a given date in one query.
 */
export async function listDayAvailability(
  date: string,
  tours: Tour[],
): Promise<SlotAvailability[]> {
  const bookingsSnap = await db
    .collection('bookings')
    .where('date', '==', date)
    .get();
  const blackoutsSnap = await db
    .collection('blackouts')
    .where('date', '==', date)
    .get();

  const activeBookings = bookingsSnap.docs
    .map((d) => d.data() as Booking)
    .filter((b) => (ACTIVE_STATUSES as readonly string[]).includes(b.status));
  const blackouts = blackoutsSnap.docs.map((d) => d.data() as Blackout);

  const wholeDayBooked = activeBookings.some(
    (b) => b.timeSlot === 'whole-day',
  );
  const dayBlackedOut = blackouts.some((bo) =>
    bo.affectedSlots.includes('all'),
  );

  const slotsSeen = new Set<TourTimeSlot>();
  const result: SlotAvailability[] = [];

  for (const tour of tours) {
    if (slotsSeen.has(tour.timeSlot)) continue;
    slotsSeen.add(tour.timeSlot);

    const slotBackedOut = blackouts.some((bo) =>
      bo.affectedSlots.includes(tour.timeSlot),
    );
    const slotBookings = activeBookings.filter(
      (b) => b.timeSlot === tour.timeSlot,
    );
    const hasPrivate = slotBookings.some((b) => b.type === 'private');
    const slotMax = tour.maxGuests;
    // No recorded party size fills the boat, as in rule 5.
    const sharedUsed = slotBookings
      .filter((b) => b.type === 'shared')
      .reduce((sum, b) => sum + (b.guestCount >= 1 ? b.guestCount : slotMax), 0);

    const closed = dayBlackedOut || slotBackedOut || wholeDayBooked;
    const sharedRemaining = closed || hasPrivate
      ? 0
      : Math.max(0, slotMax - sharedUsed);
    const privateAvailable = !closed && !hasPrivate && sharedUsed === 0;

    result.push({
      timeSlot: tour.timeSlot,
      sharedRemaining,
      privateAvailable,
      blackedOut: dayBlackedOut || slotBackedOut,
      wholeDayBooked,
    });
  }

  return result;
}

/** Calendar-month range scan to grey out blackout dates. */
export async function listMonthBlackouts(
  year: number,
  month: number, // 1-12
): Promise<string[]> {
  const start = `${year}-${String(month).padStart(2, '0')}-01`;
  const end = `${year}-${String(month).padStart(2, '0')}-31`;
  const snap = await db
    .collection('blackouts')
    .where('date', '>=', start)
    .where('date', '<=', end)
    .get();
  const blackedOut = new Set<string>();
  for (const doc of snap.docs) {
    const bo = doc.data() as Blackout;
    if (bo.affectedSlots.includes('all')) blackedOut.add(bo.date);
  }
  return [...blackedOut];
}

import type { Transaction } from 'firebase-admin/firestore';
import { db } from './firebase';
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
 * Rules (mirror src/lib/firebase/types.ts and the rebuild-plan spec):
 *  1. If a blackout covers the whole day (`'all'`) or the requested slot → reject.
 *  2. If a whole-day-private booking exists on that date → reject all other slots.
 *  3. If a private booking exists for the same slot → reject any new booking.
 *  4. If a new booking is private and any shared booking exists for the slot → reject.
 *  5. For shared bookings → existing guest count + new guest count must be ≤ maxGuests.
 *  6. guestCount must be in [1, maxGuests].
 */
export async function checkAvailability(opts: {
  tour: Tour;
  date: string;
  guestCount: number;
  tx?: Transaction;
}): Promise<{ existingBookings: Booking[]; blackouts: Blackout[] }> {
  const { tour, date, guestCount, tx } = opts;

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

  // Filter to only the bookings that occupy a slot.
  const activeBookings = allBookings.filter((b) =>
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

  // Rule 5: shared capacity.
  if (tour.type === 'shared') {
    const used = slotBookings.reduce((sum, b) => sum + b.guestCount, 0);
    if (used + guestCount > tour.maxGuests) {
      throw new AvailabilityError(
        'slot-shared-full',
        `Only ${Math.max(0, tour.maxGuests - used)} of ${tour.maxGuests} spots remain for the ${tour.timeSlot} tour on ${date}.`,
      );
    }
  }

  return { existingBookings: slotBookings, blackouts };
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
    const sharedUsed = slotBookings
      .filter((b) => b.type === 'shared')
      .reduce((sum, b) => sum + b.guestCount, 0);

    const closed = dayBlackedOut || slotBackedOut || wholeDayBooked;
    const slotMax = tour.maxGuests;
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

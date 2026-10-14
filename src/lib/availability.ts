/**
 * Availability rules for the booking UI. Pure functions — used by the
 * /api/availability route on the server and by the booking flow in the
 * browser.
 *
 * Mirrors functions/src/lib/availability.ts. That Cloud Function is still
 * the authority: createCheckoutSession re-checks everything inside a
 * Firestore transaction before anyone pays. If the rules change there,
 * change them here too.
 */
import { slotOrder, tours, type MarketingTour, type TourTimeSlot, type TourType } from './tours';

/** Seats on the boat. Every tour in the catalog uses the same boat. */
export const BOAT_CAPACITY = 6;

/**
 * Online booking for a departure closes this long before it leaves.
 * Last-minute seats are a phone call — Travis may already be on the water.
 */
export const ONLINE_CUTOFF_MINUTES = 60;

const ACTIVE_STATUSES = new Set(['pending-payment', 'confirmed']);

export interface BookingLite {
  date: string;
  timeSlot: TourTimeSlot;
  type: TourType;
  guestCount: number;
  status: string;
}

export interface BlackoutLite {
  date: string;
  /** `'all'` or specific time slots. */
  affectedSlots: string[];
}

export interface SlotState {
  timeSlot: TourTimeSlot;
  /** Seats still open on the shared tour. 0 for the whole-day slot. */
  sharedRemaining: number;
  /** The whole boat can still be booked privately for this slot. */
  privateAvailable: boolean;
  /** Someone already has the whole boat for this slot. Null when the data
   *  source can't tell (the Cloud Function fallback). */
  privatelyBooked: boolean | null;
  /** Closed by a blackout or a whole-day charter. */
  closed: boolean;
  /** Already left, or leaves inside the online cutoff. */
  departed: boolean;
}

export interface DayAvailability {
  date: string;
  /** Blacked out for the whole day (weather, maintenance, day off). */
  closed: boolean;
  /** The four two-hour slots in order, then `whole-day`. */
  slots: SlotState[];
}

/** "Now" at the marina: date + minutes since midnight, America/New_York. */
export interface MarinaClock {
  date: string;
  minutes: number;
}

export function marinaNow(at: Date = new Date()): MarinaClock {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
  };
}

function slotWindow(slot: TourTimeSlot): { start: number; end: number } {
  const tour = tours.find((t) => t.timeSlot === slot);
  const [h, m] = (tour?.startTime ?? '00:00').split(':').map(Number);
  const start = (h ?? 0) * 60 + (m ?? 0);
  return { start, end: start + (tour?.durationHours ?? 0) * 60 };
}

/** Two-hour slots that fall inside the whole-day charter's hours. */
export const WHOLE_DAY_OVERLAPS: TourTimeSlot[] = slotOrder.filter((slot) => {
  const a = slotWindow(slot);
  const b = slotWindow('whole-day');
  return a.start < b.end && b.start < a.end;
});

/**
 * Has this departure left, or is it inside the online-booking cutoff?
 * Always evaluated against the clock now — never trust a cached answer.
 * createCheckoutSession applies the same rule (functions/src/lib/datetime.ts).
 */
export function departureClosed(date: string, slot: TourTimeSlot, now: MarinaClock = marinaNow()): boolean {
  if (date < now.date) return true;
  if (date > now.date) return false;
  return slotWindow(slot).start - ONLINE_CUTOFF_MINUTES <= now.minutes;
}

/** Availability for one date from that date's bookings and blackouts. */
export function computeDay(
  date: string,
  bookings: BookingLite[],
  blackouts: BlackoutLite[],
  now: MarinaClock = marinaNow(),
): DayAvailability {
  const active = bookings.filter((b) => b.date === date && ACTIVE_STATUSES.has(b.status));
  const dayBlackouts = blackouts.filter((b) => b.date === date);

  const dayClosed = dayBlackouts.some((b) => b.affectedSlots.includes('all'));
  const wholeDayBooked = active.some((b) => b.timeSlot === 'whole-day');
  // A blackout on the charter itself, or on any slot inside its hours,
  // rules out the whole day. (Same rule as the Cloud Function's
  // WHOLE_DAY_OVERLAPS.)
  const wholeDayBlackout = dayBlackouts.some(
    (b) =>
      b.affectedSlots.includes('whole-day') ||
      WHOLE_DAY_OVERLAPS.some((slot) => b.affectedSlots.includes(slot)),
  );

  const slots: SlotState[] = slotOrder.map((slot) => {
    const slotBlackout = dayBlackouts.some((b) => b.affectedSlots.includes(slot));
    const inSlot = active.filter((b) => b.timeSlot === slot);
    const hasPrivate = inSlot.some((b) => b.type === 'private');
    const sharedUsed = inSlot
      .filter((b) => b.type === 'shared')
      .reduce((sum, b) => sum + b.guestCount, 0);
    const closed = dayClosed || slotBlackout || wholeDayBooked;
    return {
      timeSlot: slot,
      sharedRemaining: closed || hasPrivate ? 0 : Math.max(0, BOAT_CAPACITY - sharedUsed),
      privateAvailable: !closed && !hasPrivate && sharedUsed === 0,
      privatelyBooked: hasPrivate,
      closed,
      departed: departureClosed(date, slot, now),
    };
  });

  // The whole-day charter needs an empty calendar: no bookings at all
  // that day (rule 2b in the Cloud Function), and no blackout over its hours.
  slots.push({
    timeSlot: 'whole-day',
    sharedRemaining: 0,
    privateAvailable: !dayClosed && !wholeDayBlackout && active.length === 0,
    privatelyBooked: wholeDayBooked,
    closed: dayClosed || wholeDayBooked || wholeDayBlackout,
    departed: departureClosed(date, 'whole-day', now),
  });

  return { date, closed: dayClosed, slots };
}

/** Every date from `from` to `to` inclusive, as YYYY-MM-DD. */
export function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  const [fy, fm, fd] = from.split('-').map(Number);
  const cursor = new Date(Date.UTC(fy!, fm! - 1, fd!));
  for (let i = 0; i < 400; i++) {
    const iso = cursor.toISOString().slice(0, 10);
    if (iso > to) break;
    out.push(iso);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

export function computeRange(
  from: string,
  to: string,
  bookings: BookingLite[],
  blackouts: BlackoutLite[],
  now: MarinaClock = marinaNow(),
): DayAvailability[] {
  return dateRange(from, to).map((d) => computeDay(d, bookings, blackouts, now));
}

// ---------------------------------------------------------------------------
// Questions the UI asks
// ---------------------------------------------------------------------------

export type OptionStatus =
  | { bookable: true; seatsLeft: number | null }
  | {
      bookable: false;
      reason:
        | 'closed'
        | 'departed'
        | 'full'
        | 'too-few-seats'
        | 'shared-booked'
        | 'private-booked'
        | 'taken'
        | 'day-booked';
      seatsLeft?: number;
    };

/**
 * Can this tour be booked on this day for this many guests?
 *
 * `date` is needed when `day` hasn't loaded, so departures that have left
 * are still refused. `now` defaults to the clock right now.
 */
export function tourStatus(
  tour: MarketingTour,
  day: DayAvailability | undefined,
  guests: number,
  { date = day?.date, now = marinaNow() }: { date?: string; now?: MarinaClock } = {},
): OptionStatus {
  if (date && departureClosed(date, tour.timeSlot, now)) return { bookable: false, reason: 'departed' };
  // No seat data (still loading, or the read failed): let the guest
  // continue. Checkout re-checks seats before payment.
  if (!day) return { bookable: true, seatsLeft: null };
  const slot = day.slots.find((s) => s.timeSlot === tour.timeSlot);
  if (!slot) return { bookable: true, seatsLeft: null };
  if (slot.closed) return { bookable: false, reason: 'closed' };

  if (tour.type === 'shared') {
    if (slot.sharedRemaining === 0) return { bookable: false, reason: 'full' };
    if (slot.sharedRemaining < guests) {
      return { bookable: false, reason: 'too-few-seats', seatsLeft: slot.sharedRemaining };
    }
    return { bookable: true, seatsLeft: slot.sharedRemaining };
  }

  if (!slot.privateAvailable) {
    if (tour.timeSlot === 'whole-day') return { bookable: false, reason: 'day-booked' };
    return {
      bookable: false,
      reason:
        slot.privatelyBooked === null ? 'taken' : slot.privatelyBooked ? 'private-booked' : 'shared-booked',
    };
  }
  return { bookable: true, seatsLeft: null };
}

/** The three things people actually choose between. */
export type TourKind = 'any' | 'shared' | 'private' | 'whole-day';

export function matchesKind(tour: MarketingTour, kind: TourKind): boolean {
  if (kind === 'any') return true;
  if (kind === 'whole-day') return tour.timeSlot === 'whole-day';
  if (kind === 'private') return tour.type === 'private' && tour.timeSlot !== 'whole-day';
  return tour.type === 'shared';
}

export function kindOfTour(tour: MarketingTour): Exclude<TourKind, 'any'> {
  if (tour.timeSlot === 'whole-day') return 'whole-day';
  return tour.type;
}

export type DayLevel = 'open' | 'limited' | 'full' | 'closed' | 'unknown';

/**
 * One word for a calendar cell: can a group of `guests` book a tour of
 * this kind on this day, and is it getting tight? "Limited" means half or
 * fewer of the day's departures are still bookable.
 */
export function dayLevel(
  day: DayAvailability | undefined,
  guests: number,
  kind: TourKind = 'any',
  now: MarinaClock = marinaNow(),
): DayLevel {
  if (!day) return 'unknown';
  if (day.closed) return 'closed';
  const candidates = tours.filter((t) => t.active && matchesKind(t, kind));
  const bookable = candidates.filter((t) => tourStatus(t, day, guests, { now }).bookable);
  if (bookable.length === 0) {
    const allGone = candidates.every((t) => {
      const s = day.slots.find((x) => x.timeSlot === t.timeSlot);
      return !s || s.closed || departureClosed(day.date, t.timeSlot, now);
    });
    return allGone ? 'closed' : 'full';
  }
  return bookable.length <= candidates.length / 2 ? 'limited' : 'open';
}

/** Human copy for an unavailable option. */
export function statusLabel(status: OptionStatus, tour: MarketingTour): string {
  if (status.bookable) {
    if (tour.type === 'private') return tour.timeSlot === 'whole-day' ? 'Whole day open' : 'Boat available';
    if (status.seatsLeft == null) return 'Seats available';
    return status.seatsLeft === 1 ? '1 seat left' : `${status.seatsLeft} seats left`;
  }
  switch (status.reason) {
    case 'departed':
      return 'Call for same-day';
    case 'closed':
      return 'Not running';
    case 'full':
      return 'Sold out';
    case 'too-few-seats':
      return status.seatsLeft === 1 ? 'Only 1 seat left' : `Only ${status.seatsLeft} seats left`;
    case 'shared-booked':
      return 'Shared guests booked';
    case 'private-booked':
      return 'Booked privately';
    case 'taken':
      return 'Not available';
    case 'day-booked':
      return 'Day already has bookings';
  }
}

/** Link into the booking flow with a tour (and optionally a date) chosen. */
export function bookingHref(tour: MarketingTour, opts: { date?: string; guests?: number } = {}): string {
  const qs = new URLSearchParams({ tour: tour.slug, type: kindOfTour(tour) });
  if (opts.date) qs.set('date', opts.date);
  if (opts.guests) qs.set('guests', String(opts.guests));
  return `/book?${qs.toString()}`;
}

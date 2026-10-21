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
import { monthName } from './date';
import { slotOrder, tours, type MarketingTour, type TourTimeSlot, type TourType } from './tours';
import { SLOT_MINUTES, SLOT_SEASONS, SLOT_START_TIMES, slotConflicts, slotRunsOn, slotStartMinutes } from './schedule';

/** Seats on the boat. Every tour in the catalog uses the same boat. */
export const BOAT_CAPACITY = 6;

/**
 * Online booking for a departure closes this long before it leaves.
 * Last-minute seats are a phone call — Travis may already be on the water.
 */
export const ONLINE_CUTOFF_MINUTES = 60;

/** Bookings that hold seats. Nothing else counts, so /api/availability reads only these. */
export const ACTIVE_STATUSES = new Set(['pending-payment', 'confirmed']);

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
  /** Someone already has the whole boat for this slot. Null when the other
   *  departure it overlaps has the boat, or when the data source can't tell
   *  (the Cloud Function fallback). */
  privatelyBooked: boolean | null;
  /** Closed by a blackout or a whole-day charter, or out of season. */
  closed: boolean;
  /** Already left, or leaves inside the online cutoff. */
  departed: boolean;
}

export interface DayAvailability {
  date: string;
  /** Blacked out for the whole day (weather, maintenance, day off). */
  closed: boolean;
  /** The four two-hour slots in order, the sunset cruise, then `whole-day`. */
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

/** A departure that leaves at the same time every day, in minutes. */
function fixedWindow(slot: keyof typeof SLOT_START_TIMES): { start: number; end: number } {
  const [h, m] = SLOT_START_TIMES[slot].split(':').map(Number);
  const start = (h ?? 0) * 60 + (m ?? 0);
  return { start, end: start + SLOT_MINUTES[slot] };
}

/** Two-hour slots that fall inside the whole-day charter's hours. */
export const WHOLE_DAY_OVERLAPS: TourTimeSlot[] = slotOrder.filter((slot) => {
  if (slot === 'sunset') return false;
  const a = fixedWindow(slot);
  const b = fixedWindow('whole-day');
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
  return slotStartMinutes(slot, date) - ONLINE_CUTOFF_MINUTES <= now.minutes;
}

/**
 * Has the boat already left on this departure (its start time, marina
 * time)? Not the online cutoff: inside that it can still be booked by phone.
 */
export function departureLeft(date: string, slot: TourTimeSlot, now: MarinaClock = marinaNow()): boolean {
  if (date !== now.date) return date < now.date;
  return now.minutes >= slotStartMinutes(slot, date);
}

/**
 * A seasonal departure's season in words, "April 1 – November 14", from
 * SLOT_SEASONS, so the copy can't drift from the rule. Null for a departure
 * that runs all year.
 */
export function seasonWords(slot: TourTimeSlot): string | null {
  const season = SLOT_SEASONS[slot];
  if (!season) return null;
  const words = (monthDay: string) => `${monthName(Number(monthDay.slice(0, 2)) - 1)} ${Number(monthDay.slice(3))}`;
  return `${words(season.from)} – ${words(season.to)}`;
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

  const slots: SlotState[] = [...slotOrder, 'sunset' as const].map((slot) => {
    const slotBlackout = dayBlackouts.some((b) => b.affectedSlots.includes(slot));
    const inSlot = active.filter((b) => b.timeSlot === slot);
    const hasPrivate = inSlot.some((b) => b.type === 'private');
    // An old-site booking with no recorded party size (guestCount 0) fills
    // the boat, as in the Cloud Function's rule 5.
    const sharedUsed = inSlot
      .filter((b) => b.type === 'shared')
      .reduce((sum, b) => sum + (b.guestCount >= 1 ? b.guestCount : BOAT_CAPACITY), 0);
    // An overlapping departure that's booked has the boat: the sunset cruise
    // and the 3:30 tour, late in the season (the Cloud Function's rule 2c).
    const boatTaken = slotConflicts(slot, date).some((other) => active.some((b) => b.timeSlot === other));
    const closed = dayClosed || slotBlackout || wholeDayBooked || !slotRunsOn(slot, date);
    return {
      timeSlot: slot,
      sharedRemaining: closed || hasPrivate || boatTaken ? 0 : Math.max(0, BOAT_CAPACITY - sharedUsed),
      privateAvailable: !closed && !hasPrivate && !boatTaken && sharedUsed === 0,
      // Taken by the other departure: "not available", not "booked privately".
      privatelyBooked: boatTaken && !hasPrivate ? null : hasPrivate,
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
      /** `departed`: the boat has left. `cutoff`: it leaves inside the online cutoff, so it's booked by phone. */
      reason:
        | 'closed'
        | 'departed'
        | 'cutoff'
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
  if (date && departureClosed(date, tour.timeSlot, now)) {
    return { bookable: false, reason: departureLeft(date, tour.timeSlot, now) ? 'departed' : 'cutoff' };
  }
  // No seat data (still loading, or the read failed): let the guest
  // continue. Checkout re-checks seats before payment.
  if (!day) return { bookable: true, seatsLeft: null };
  const slot = day.slots.find((s) => s.timeSlot === tour.timeSlot);
  if (!slot) return { bookable: true, seatsLeft: null };
  if (slot.closed) return { bookable: false, reason: 'closed' };

  if (tour.type === 'shared') {
    // The sunset cruise has the boat, so the 3:30 isn't sold out: it reads
    // like the private side. Only a departure that overlaps another can be
    // taken that way; anywhere else a null is the fallback not knowing, and
    // no seats is sold out.
    if (slot.privatelyBooked === null && slotConflicts(tour.timeSlot, day.date).length > 0) {
      return { bookable: false, reason: 'taken' };
    }
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
  catalog: readonly MarketingTour[] = tours,
): DayLevel {
  if (!day) return 'unknown';
  if (day.closed) return 'closed';
  const candidates = catalog.filter((t) => t.active && matchesKind(t, kind));
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
    // Later departures today are still booked online: only one leaving
    // within the hour is a phone call, and one that has left is gone.
    case 'departed':
      return 'Already left';
    case 'cutoff':
      return 'Call to book';
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

// ---------------------------------------------------------------------------
// Lists built from a range of days (home page board, tour-page dates)
// ---------------------------------------------------------------------------

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
 * The next two-hour departures that can still be booked, soonest first.
 * Pass the live catalog so a tour Travis switched off counts as full; the
 * other tour at that time still shows.
 */
export function upcomingFrom(
  days: DayAvailability[],
  limit: number,
  now: MarinaClock = marinaNow(),
  catalog: readonly MarketingTour[] = tours,
): UpcomingDeparture[] {
  const out: UpcomingDeparture[] = [];
  for (const day of days) {
    for (const slot of day.slots) {
      if (slot.timeSlot === 'whole-day' || slot.closed || departureClosed(day.date, slot.timeSlot, now)) continue;
      const shared = catalog.find((t) => t.timeSlot === slot.timeSlot && t.type === 'shared');
      const priv = catalog.find((t) => t.timeSlot === slot.timeSlot && t.type === 'private');
      if (!shared || !priv) continue;
      const seatsLeft = shared.active ? slot.sharedRemaining : 0;
      const privateOpen = priv.active && slot.privateAvailable;
      if (seatsLeft === 0 && !privateOpen) continue;
      out.push({ date: day.date, shared, private: priv, seatsLeft, privateOpen });
      if (out.length >= limit) return out;
    }
  }
  return out;
}

/** Dates a tour can be booked for at least one guest, soonest first. */
export function openDatesFrom(
  tour: MarketingTour,
  days: DayAvailability[],
  limit: number,
  now: MarinaClock = marinaNow(),
): Array<{ date: string; seatsLeft: number | null }> {
  const out: Array<{ date: string; seatsLeft: number | null }> = [];
  for (const day of days) {
    const status = tourStatus(tour, day, 1, { now });
    if (!status.bookable) continue;
    out.push({ date: day.date, seatsLeft: status.seatsLeft });
    if (out.length >= limit) break;
  }
  return out;
}

export function addDaysIso(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + n)).toISOString().slice(0, 10);
}

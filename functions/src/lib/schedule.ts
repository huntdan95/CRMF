import type { TourTimeSlot } from './types';

/*
 * When each departure leaves and gets back, marina time. The schedule is
 * code, not something Travis edits (see src/lib/tours.ts and
 * scripts/seed.ts), so checks that only need the departure time don't have
 * to read the tour doc.
 *
 * MUST stay in sync with src/lib/schedule.ts in the parent Next.js app.
 */

/** Departures that leave at the same time every day, `HH:MM`. */
export const SLOT_START_TIMES: Record<Exclude<TourTimeSlot, 'sunset'>, string> = {
  morning: '08:00',
  'mid-morning': '10:30',
  'early-afternoon': '13:00',
  'late-afternoon': '15:30',
  'whole-day': '07:00',
};

/** How long each departure is out, in minutes. */
export const SLOT_MINUTES: Record<TourTimeSlot, number> = {
  morning: 120,
  'mid-morning': 120,
  'early-afternoon': 120,
  'late-afternoon': 120,
  'whole-day': 480,
  sunset: 120,
};

/** Every departure except the whole-day charter, which has its own rule. */
const TIMED_SLOTS: readonly TourTimeSlot[] = [
  'morning',
  'mid-morning',
  'early-afternoon',
  'late-afternoon',
  'sunset',
];

/** Time the boat needs between trips: cleaning, turnaround. */
export const TURNAROUND_MINUTES = 30;

/**
 * Departures that only run part of the year: first and last day, `MM-DD`,
 * inclusive. The sunset cruise is off-season only (the manatee season is
 * mid-November through March).
 */
export const SLOT_SEASONS: Partial<Record<TourTimeSlot, { from: string; to: string }>> = {
  sunset: { from: '04-01', to: '11-14' },
};

/** The sunset cruise leaves this long before sunset, rounded down to the quarter hour. */
export const SUNSET_LEAD_MINUTES = 90;

/** Pete's Pier Marina, for working out sunset. */
const MARINA = { latitude: 28.8966, longitude: -82.5915 };

const rad = (deg: number) => (deg * Math.PI) / 180;

/**
 * Minutes after midnight, marina time, that the sun sets at the marina on
 * `date` (`YYYY-MM-DD`). NOAA's general solar position equations: good to
 * a minute or two, which the quarter-hour rounding absorbs.
 */
export function sunsetMinutes(date: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const dayOfYear = (Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 0)) / 86_400_000;
  // Fractional year, at about 6 PM.
  const g = ((2 * Math.PI) / 365) * (dayOfYear - 1 + 0.25);
  const eqTime =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(g) -
      0.032077 * Math.sin(g) -
      0.014615 * Math.cos(2 * g) -
      0.040849 * Math.sin(2 * g));
  const decl =
    0.006918 -
    0.399912 * Math.cos(g) +
    0.070257 * Math.sin(g) -
    0.006758 * Math.cos(2 * g) +
    0.000907 * Math.sin(2 * g) -
    0.002697 * Math.cos(3 * g) +
    0.00148 * Math.sin(3 * g);
  const lat = rad(MARINA.latitude);
  const hourAngle =
    (Math.acos(Math.cos(rad(90.833)) / (Math.cos(lat) * Math.cos(decl)) - Math.tan(lat) * Math.tan(decl)) * 180) /
    Math.PI;
  const utcMinutes = 720 - 4 * (MARINA.longitude - hourAngle) - eqTime;

  // Into marina time, daylight saving included.
  const at = new Date(Date.UTC(y, m - 1, d) + Math.round(utcMinutes) * 60_000);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return get('hour') * 60 + get('minute');
}

/** Minutes after midnight, marina time, that `slot` leaves on `date`. */
export function slotStartMinutes(slot: TourTimeSlot, date: string): number {
  if (slot === 'sunset') {
    return Math.floor((sunsetMinutes(date) - SUNSET_LEAD_MINUTES) / 15) * 15;
  }
  const [h, m] = SLOT_START_TIMES[slot].split(':').map(Number) as [number, number];
  return h * 60 + m;
}

/** `HH:MM` that `slot` leaves on `date`. */
export function slotStartTime(slot: TourTimeSlot, date: string): string {
  const mins = slotStartMinutes(slot, date);
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
}

/** Does `slot` run at all on `date`? False outside a seasonal departure's season. */
export function slotRunsOn(slot: TourTimeSlot, date: string): boolean {
  const season = SLOT_SEASONS[slot];
  if (!season) return true;
  const monthDay = date.slice(5);
  return monthDay >= season.from && monthDay <= season.to;
}

/**
 * The other departures that can't run on `date` once `slot` has a booking:
 * they'd overlap it, turnaround included. In practice that's the sunset
 * cruise and the 3:30 tour from late September on; whichever is booked
 * first takes the boat. The whole-day charter isn't counted: it needs the
 * day otherwise empty, a rule of its own.
 *
 * Seasons don't come into it. Out of season the sunset cruise isn't sold
 * (callers check slotRunsOn for the departure being booked), but one
 * already booked on it, an old-site sunset tour, still has the boat at its
 * real time, so on a December evening it keeps the 3:30 off sale.
 */
export function slotConflicts(slot: TourTimeSlot, date: string): TourTimeSlot[] {
  if (slot === 'whole-day') return [];
  const start = slotStartMinutes(slot, date);
  const end = start + SLOT_MINUTES[slot];
  return TIMED_SLOTS.filter((other) => {
    if (other === slot) return false;
    const otherStart = slotStartMinutes(other, date);
    const otherEnd = otherStart + SLOT_MINUTES[other];
    return start < otherEnd + TURNAROUND_MINUTES && otherStart < end + TURNAROUND_MINUTES;
  });
}

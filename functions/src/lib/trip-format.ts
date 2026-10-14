import { SLOT_START_TIMES } from './schedule';
import type { Booking, TourTimeSlot } from './types';

/*
 * How dates and departures read in the automated emails. Everything is
 * marina time (America/New_York); a booking's `date` is already a marina
 * date, so these only format it.
 */

function utcDate(iso: string): Date {
  const [y = 0, m = 1, d = 1] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** `2026-10-17` → `Sat Oct 17`. */
export function shortDate(iso: string): string {
  return utcDate(iso)
    .toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
    .replace(',', '');
}

/** `2026-10-17` → `Saturday, October 17`. */
export function longDate(iso: string): string {
  return utcDate(iso).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

/** `2026-10-17` → `Saturday`. */
export function weekday(iso: string): string {
  return utcDate(iso).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
}

/** `08:00` → `8:00 AM`. */
export function clockTime(hhmm: string): string {
  const [h = 0, m = 0] = hhmm.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

/** When the boat leaves for this slot, e.g. `10:30 AM`. */
export function departureTime(timeSlot: TourTimeSlot): string {
  return clockTime(SLOT_START_TIMES[timeSlot] ?? '00:00');
}

/** `10:30 AM shared`, `7:00 AM whole-day private`. */
export function departureLabel(b: Pick<Booking, 'timeSlot' | 'type'>): string {
  const kind = b.timeSlot === 'whole-day' ? 'whole-day private' : b.type;
  return `${departureTime(b.timeSlot)} ${kind}`;
}

/** `4 guests`, `1 guest`. */
export function guestsLabel(n: number): string {
  return `${n} ${n === 1 ? 'guest' : 'guests'}`;
}

/** Minutes past midnight the slot leaves, for sorting a day's trips. */
export function departureMinutes(timeSlot: TourTimeSlot): number {
  const [h = 0, m = 0] = (SLOT_START_TIMES[timeSlot] ?? '00:00').split(':').map(Number);
  return h * 60 + m;
}

/** `tel:` link digits for a phone number as typed. */
export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, '')}`;
}

export function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

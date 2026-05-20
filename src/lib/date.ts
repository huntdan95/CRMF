/**
 * Lightweight date helpers — avoid pulling in a full date library for the
 * three things we need: calendar grids, ISO date strings, and friendly
 * day-of-week formatting.
 *
 * All dates are in the user's local timezone for display; for storage
 * (Firestore `Booking.date`) we use a YYYY-MM-DD string computed in
 * America/New_York (where Crystal River is).
 */

/** Returns a `YYYY-MM-DD` string in the given local timezone. */
export function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Parse `YYYY-MM-DD` to a local Date (midnight). */
export function parseIsoDate(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const [, y, mo, d] = m;
  const date = new Date(Number(y), Number(mo) - 1, Number(d));
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

export function addMonths(d: Date, n: number): Date {
  const r = new Date(d);
  r.setMonth(r.getMonth() + n);
  return r;
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function startOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

/**
 * Returns the calendar grid for a given month — always 6 rows × 7 columns of
 * Date objects, padded with the trailing days of the previous month and the
 * leading days of the next month so the grid is uniform.
 */
export function calendarGrid(year: number, month0: number): Date[] {
  const first = new Date(year, month0, 1);
  const startWeekday = first.getDay(); // 0 = Sunday
  const grid: Date[] = [];
  // Start from the Sunday on or before the 1st.
  const start = new Date(year, month0, 1 - startWeekday);
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    grid.push(d);
  }
  return grid;
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export function monthName(month0: number): string {
  return MONTH_NAMES[month0] ?? '';
}

export function formatFriendlyDate(s: string): string {
  const d = parseIsoDate(s);
  if (!d) return s;
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

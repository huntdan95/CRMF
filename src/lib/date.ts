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

/**
 * True for a real calendar date in `YYYY-MM-DD` form. `2026-11-31` and
 * `2026-13-05` match the pattern but aren't dates; JavaScript would quietly
 * roll them over to December 1 and January 5.
 */
export function isValidIsoDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [, y, mo, d] = m.map(Number) as [number, number, number, number];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/**
 * Returns the UTC `Date` corresponding to a wall-clock time in the given
 * IANA timezone, whatever the browser's own timezone is. E.g.
 * `zonedTimeToUtc('2026-05-22', '08:00')` returns `2026-05-22T12:00:00Z`
 * (EDT is UTC-4 in May).
 *
 * MUST stay in sync with `zonedTimeToUtc` in functions/src/lib/datetime.ts:
 * the cancel dialog's refund preview has to land on the same side of the
 * 72-hour line as the refund cancelBooking actually gives.
 */
export function zonedTimeToUtc(
  date: string,
  time: string,
  timeZone: string = 'America/New_York',
): Date {
  const [yStr, moStr, dStr] = date.split('-');
  const [hStr, miStr] = time.split(':');
  const year = Number(yStr);
  const month = Number(moStr); // 1-12
  const day = Number(dStr);
  const hour = Number(hStr);
  const minute = Number(miStr);

  // First guess: pretend the local time is UTC.
  const guessUtcMs = Date.UTC(year, month - 1, day, hour, minute);

  // The target timezone's clock.
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  // A UTC instant as the target timezone's clock shows it, read as UTC.
  const wallClockMs = (at: number): number => {
    const parts = fmt.formatToParts(new Date(at));
    const get = (type: string): number =>
      Number(parts.find((p) => p.type === type)?.value ?? '0');
    // Intl returns "24" for midnight under hour12:false in some engines —
    // normalize.
    const h = get('hour') === 24 ? 0 : get('hour');
    return Date.UTC(get('year'), get('month') - 1, get('day'), h, get('minute'));
  };
  const offsetAt = (at: number): number => at - wallClockMs(at);

  // Shift by the offset at the first guess, then by the offset at that
  // answer. They differ only on the morning the clocks go forward, when a
  // first guess for 3:00–6:59 AM falls before the change and is an hour out.
  const first = guessUtcMs + offsetAt(guessUtcMs);
  return new Date(guessUtcMs + offsetAt(first));
}

/** Parse `YYYY-MM-DD` to a local Date (midnight). Null for non-dates. */
export function parseIsoDate(s: string): Date | null {
  if (!isValidIsoDate(s)) return null;
  const [y, mo, d] = s.split('-').map(Number);
  return new Date(y!, mo! - 1, d!);
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

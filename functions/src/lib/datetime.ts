/**
 * Timezone-aware datetime math for the booking system.
 *
 * Crystal River is in America/New_York. Bookings store the date as a
 * `YYYY-MM-DD` string and the tour stores `startTime` as `HH:MM` in local
 * (Eastern) time. To do "is this booking more than 72 hours away?" arithmetic
 * we need the precise UTC instant of the local wall-clock time.
 *
 * Uses `Intl.DateTimeFormat` to compute the timezone offset at the given
 * instant (handles DST transitions correctly).
 */

export const SITE_TIMEZONE = 'America/New_York';

/**
 * Returns the UTC `Date` corresponding to a wall-clock time in the given
 * IANA timezone. E.g. `zonedTimeToUtc('2026-05-22', '08:00', 'America/New_York')`
 * returns `2026-05-22T12:00:00Z` (EDT is UTC-4 in May).
 *
 * MUST stay in sync with `zonedTimeToUtc` in src/lib/date.ts: the cancel
 * dialog's refund preview has to land on the same side of the 72-hour line
 * as the refund cancelBooking actually gives.
 */
export function zonedTimeToUtc(
  date: string,
  time: string,
  timeZone: string = SITE_TIMEZONE,
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

/**
 * A trip date (`YYYY-MM-DD`, marina time) as "Sat Oct 17", for subject
 * lines. The date is already the marina's, so it's formatted as-is.
 */
export function tripDayLabel(date: string): string {
  const [y = 0, m = 1, d = 1] = date.split('-').map(Number);
  const parts = new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).formatToParts(new Date(Date.UTC(y, m - 1, d)));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('weekday')} ${get('month')} ${get('day')}`;
}

/** A departure's `HH:MM` as a short clock time: `08:00` → `8:00`, `13:00` → `1:00`. */
export function departureClock(hhmm: string): string {
  const [h = 0, m = 0] = hhmm.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')}`;
}

/* -------------------------------------------------------------------------- */
/* Online booking window                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Online booking for a departure closes this long before it leaves.
 * Mirrors ONLINE_CUTOFF_MINUTES in the website's src/lib/availability.ts.
 */
export const ONLINE_CUTOFF_MINUTES = 60;

/**
 * How far ahead a tour can be booked online. Mirrors the booking page's
 * `maxDate` (src/components/booking/BookingFlow.tsx).
 */
export const BOOKING_WINDOW_DAYS = 365;

/**
 * True for a `YYYY-MM-DD` string that names a day on the calendar.
 * `2026-11-31` matches the pattern but rolls over to December 1 in
 * `Date.UTC`, so it's refused.
 */
export function isRealDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === mo - 1 &&
    dt.getUTCDate() === d
  );
}

/** `YYYY-MM-DD` plus `n` calendar days. */
export function addDays(date: string, n: number): string {
  const [y, mo, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, d + n)).toISOString().slice(0, 10);
}

/** "Now" at the marina: date + minutes since midnight, in the site timezone. */
export interface MarinaClock {
  date: string;
  minutes: number;
}

/** Same as `marinaNow()` in the website's src/lib/availability.ts. */
export function marinaNow(at: Date = new Date()): MarinaClock {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: SITE_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? '00';
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
  };
}

/**
 * Has this departure left, or does it leave within the online cutoff?
 * Same rule as `departureClosed()` in the website's src/lib/availability.ts,
 * keyed on the tour's `HH:MM` start time instead of its slot.
 */
export function departureClosed(
  date: string,
  startTime: string,
  now: MarinaClock = marinaNow(),
): boolean {
  if (date < now.date) return true;
  if (date > now.date) return false;
  const [h, m] = startTime.split(':').map(Number);
  return h * 60 + m - ONLINE_CUTOFF_MINUTES <= now.minutes;
}

/**
 * Hours from `now` until the wall-clock `date` + `time` in the site timezone.
 * Negative if the tour has already started.
 */
export function hoursUntilTour(
  date: string,
  startTime: string,
  now: Date = new Date(),
): number {
  const tourUtc = zonedTimeToUtc(date, startTime);
  return (tourUtc.getTime() - now.getTime()) / (1000 * 60 * 60);
}

/* -------------------------------------------------------------------------- */
/* Cancellation refund policy                                                 */
/* -------------------------------------------------------------------------- */

export type CancellationPolicyTier = 'full' | 'half' | 'none';

export interface RefundQuote {
  tier: CancellationPolicyTier;
  refundCents: number;
  refundPercent: number;
  hoursUntilTour: number;
  /** Human-readable explanation suitable for the customer dialog. */
  explanation: string;
}

/**
 * Refund tiers:
 *   ≥ 72 hours before tour → full refund
 *   < 72 hours             → no refund
 *
 * (`half` is no longer quoted. It stays in the type because refunds made
 * under the earlier 24–72-hour 50% tier carry it in their Stripe metadata,
 * and a retried cancellation reads it back.)
 *
 * Travis-initiated cancellations (admin path) bypass this and always refund
 * in full.
 *
 * The percentage applies to what's left of the payment after any refund
 * Travis already gave, so the quote never asks Stripe for more than remains.
 *
 * A trip Travis reopened after offering a new date or a refund
 * (`refundGraceUntil`, see lib/close-day.ts putBackFields) refunds in full
 * until the end of that day, marina time, as long as it hasn't left.
 * Mirrored by `previewRefund` in the website's src/lib/refund-policy.ts:
 * the cancel dialog sends the refund it shows, and a lower one here cancels
 * nothing.
 */
export function quoteCustomerRefund(opts: {
  amountPaidCents: number;
  /** Refunded before this cancellation (e.g. a partial refund from Travis). */
  amountRefundedCents?: number;
  date: string;
  startTime: string;
  now?: Date;
  /** The booking's `refundGraceUntil`. */
  refundGraceUntil?: string | null;
}): RefundQuote {
  const hrs = hoursUntilTour(opts.date, opts.startTime, opts.now);

  let tier: CancellationPolicyTier;
  let refundPercent: number;
  let explanation: string;

  if (hrs >= 72) {
    tier = 'full';
    refundPercent = 100;
    explanation = '72+ hours before your tour — full refund.';
  } else if (hrs >= 0 && opts.refundGraceUntil && marinaNow(opts.now).date <= opts.refundGraceUntil) {
    tier = 'full';
    refundPercent = 100;
    explanation = refundGraceExplanation(opts.refundGraceUntil, opts.date);
  } else {
    tier = 'none';
    refundPercent = 0;
    explanation = hrs < 0
      ? 'Tour already started — refunds are no longer available.'
      : 'Less than 72 hours before your tour — no refund.';
  }

  const remainingCents = Math.max(
    0,
    opts.amountPaidCents - (opts.amountRefundedCents ?? 0),
  );
  const refundCents = Math.floor((remainingCents * refundPercent) / 100);

  return {
    tier,
    refundCents,
    refundPercent,
    hoursUntilTour: hrs,
    explanation,
  };
}

/**
 * Why a reopened trip still refunds in full. The deadline is usually after
 * the trip itself (3 days after the closed date), and nothing can be
 * cancelled once it has left, so then it says that instead of the date.
 * Word for word the same as the website's (src/lib/refund-policy.ts).
 */
export function refundGraceExplanation(graceUntil: string, tourDate: string): string {
  if (graceUntil >= tourDate) {
    return 'Travis reopened your trip; you can still cancel for a full refund until it leaves.';
  }
  const [y, m, d] = graceUntil.split('-').map(Number);
  const day = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
  return `Travis reopened your trip; you can still cancel for a full refund until ${day}.`;
}

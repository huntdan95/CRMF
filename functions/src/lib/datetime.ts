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
  const guessDate = new Date(guessUtcMs);

  // What does that UTC instant look like in the target timezone?
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(guessDate);
  const get = (type: string): number =>
    Number(parts.find((p) => p.type === type)?.value ?? '0');

  const displayedY = get('year');
  const displayedMo = get('month');
  const displayedD = get('day');
  // Intl returns "24" for midnight under hour12:false in some Node versions —
  // normalize.
  let displayedH = get('hour');
  if (displayedH === 24) displayedH = 0;
  const displayedMi = get('minute');

  const displayedAsUtcMs = Date.UTC(
    displayedY,
    displayedMo - 1,
    displayedD,
    displayedH,
    displayedMi,
  );

  // The offset between what `tz` shows and what we *want* it to show is the
  // shift we need to apply.
  const offsetMs = guessUtcMs - displayedAsUtcMs;
  return new Date(guessUtcMs + offsetMs);
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
 */
export function quoteCustomerRefund(opts: {
  amountPaidCents: number;
  /** Refunded before this cancellation (e.g. a partial refund from Travis). */
  amountRefundedCents?: number;
  date: string;
  startTime: string;
  now?: Date;
}): RefundQuote {
  const hrs = hoursUntilTour(opts.date, opts.startTime, opts.now);

  let tier: CancellationPolicyTier;
  let refundPercent: number;
  let explanation: string;

  if (hrs >= 72) {
    tier = 'full';
    refundPercent = 100;
    explanation = '72+ hours before your tour — full refund.';
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

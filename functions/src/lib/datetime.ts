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
 * Refund tiers (default v1; Phase 6 admin will be able to override per-booking
 * if needed):
 *   ≥ 72 hours before tour → full refund
 *   24–72 hours            → 50% refund
 *   < 24 hours             → no refund
 *
 * Travis-initiated cancellations (admin path) bypass this and always refund
 * in full.
 */
export function quoteCustomerRefund(opts: {
  amountPaidCents: number;
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
  } else if (hrs >= 24) {
    tier = 'half';
    refundPercent = 50;
    explanation = '24-72 hours before your tour — 50% refund.';
  } else {
    tier = 'none';
    refundPercent = 0;
    explanation = hrs < 0
      ? 'Tour already started — refunds are no longer available online. Call Travis if there\'s a special circumstance.'
      : 'Less than 24 hours before your tour — no refund available online. Call Travis if there\'s an emergency.';
  }

  const refundCents = Math.floor((opts.amountPaidCents * refundPercent) / 100);

  return {
    tier,
    refundCents,
    refundPercent,
    hoursUntilTour: hrs,
    explanation,
  };
}

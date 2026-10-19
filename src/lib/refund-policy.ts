/**
 * Client-side mirror of the Cloud-Function `quoteCustomerRefund` calculation.
 *
 * Used to *preview* the refund amount in the cancellation dialog before the
 * customer confirms. Server is authoritative — the real refund is computed
 * again inside the Cloud Function.
 *
 * The departure is the tour's start time in marina time (America/New_York),
 * as the server works it out, so a customer in California or Hawaii sees the
 * same side of the 72-hour line. It still runs on the customer's clock,
 * which can be off or go stale while the dialog sits open: the dialog sends
 * the amount it showed, and cancelBooking cancels nothing if its own refund
 * is lower.
 */

import { isValidIsoDate, zonedTimeToUtc } from './date';

export type RefundTier = 'full' | 'none';

export interface RefundPreview {
  tier: RefundTier;
  refundCents: number;
  refundPercent: number;
  hoursUntilTour: number;
  explanation: string;
}

export function previewRefund(opts: {
  amountPaidCents: number;
  /** Already refunded, e.g. part of it by Travis. The policy applies to the rest. */
  amountRefundedCents?: number;
  date: string;
  /** `HH:MM` 24-hour, marina time: `slotStartTime(booking.timeSlot, booking.date)`. */
  startTime: string;
  now?: Date;
}): RefundPreview {
  if (!isValidIsoDate(opts.date)) {
    return {
      tier: 'none',
      refundCents: 0,
      refundPercent: 0,
      hoursUntilTour: Number.NaN,
      explanation: '',
    };
  }
  const departs = zonedTimeToUtc(opts.date, opts.startTime);
  const now = opts.now ?? new Date();
  const hours = (departs.getTime() - now.getTime()) / (1000 * 60 * 60);

  let tier: RefundTier;
  let percent: number;
  let explanation: string;

  if (hours >= 72) {
    tier = 'full';
    percent = 100;
    explanation = 'More than 72 hours away — full refund.';
  } else if (hours >= 0) {
    tier = 'none';
    percent = 0;
    explanation = 'Less than 72 hours before your tour — no refund.';
  } else {
    tier = 'none';
    percent = 0;
    explanation = 'Tour already started — refunds are no longer available.';
  }

  return {
    tier,
    refundCents: Math.floor(
      (Math.max(0, opts.amountPaidCents - (opts.amountRefundedCents ?? 0)) * percent) / 100,
    ),
    refundPercent: percent,
    hoursUntilTour: hours,
    explanation,
  };
}

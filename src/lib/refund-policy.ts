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

import { marinaNow } from './availability';
import { formatFriendlyDate, isValidIsoDate, zonedTimeToUtc } from './date';

export type RefundTier = 'full' | 'none';

export interface RefundPreview {
  tier: RefundTier;
  refundCents: number;
  refundPercent: number;
  hoursUntilTour: number;
  explanation: string;
}

/**
 * Travis reopened the trip after offering a new date or a refund, and that
 * offer's deadline (`refundGraceUntil`) hasn't passed, marina time: until
 * then cancelling refunds in full. Same rule as the server's.
 */
export function inRefundGrace(refundGraceUntil: string | null | undefined, now: Date = new Date()): boolean {
  return !!refundGraceUntil && marinaNow(now).date <= refundGraceUntil;
}

/**
 * Why a reopened trip still refunds in full. Word for word the server's
 * (`refundGraceExplanation` in functions/src/lib/datetime.ts). The deadline
 * is usually after the trip itself, and nothing can be cancelled once it has
 * left, so then it says that instead of the date.
 */
export function refundGraceExplanation(graceUntil: string, tourDate: string): string {
  return graceUntil >= tourDate
    ? 'Travis reopened your trip; you can still cancel for a full refund until it leaves.'
    : `Travis reopened your trip; you can still cancel for a full refund until ${formatFriendlyDate(graceUntil)}.`;
}

export function previewRefund(opts: {
  amountPaidCents: number;
  /** Already refunded, e.g. part of it by Travis. The policy applies to the rest. */
  amountRefundedCents?: number;
  date: string;
  /** `HH:MM` 24-hour, marina time: `slotStartTime(booking.timeSlot, booking.date)`. */
  startTime: string;
  now?: Date;
  /** The booking's `refundGraceUntil`: a trip Travis reopened refunds in full until then. */
  refundGraceUntil?: string | null;
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
  } else if (hours >= 0 && opts.refundGraceUntil && inRefundGrace(opts.refundGraceUntil, now)) {
    tier = 'full';
    percent = 100;
    explanation = refundGraceExplanation(opts.refundGraceUntil, opts.date);
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

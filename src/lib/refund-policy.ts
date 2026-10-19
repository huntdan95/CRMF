/**
 * Client-side mirror of the Cloud-Function `quoteCustomerRefund` calculation.
 *
 * Used to *preview* the refund amount in the cancellation dialog before the
 * customer confirms. Server is authoritative — the real refund is computed
 * again inside the Cloud Function.
 *
 * Approximate: uses the customer's browser clock, and treats the tour time
 * as a local-time value (good enough for a UI preview within a couple of
 * hours of the policy boundaries).
 */

import { parseIsoDate } from './date';

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
  /** `HH:MM` 24-hour. */
  startTime: string;
  now?: Date;
}): RefundPreview {
  const d = parseIsoDate(opts.date);
  if (!d) {
    return {
      tier: 'none',
      refundCents: 0,
      refundPercent: 0,
      hoursUntilTour: Number.NaN,
      explanation: '',
    };
  }
  const [h, m] = opts.startTime.split(':').map(Number);
  d.setHours(h ?? 0, m ?? 0, 0, 0);
  const now = opts.now ?? new Date();
  const hours = (d.getTime() - now.getTime()) / (1000 * 60 * 60);

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

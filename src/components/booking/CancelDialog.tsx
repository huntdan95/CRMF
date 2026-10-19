'use client';

import { useEffect, useState } from 'react';
import { formatPrice } from '@/lib/tours';
import { previewRefund, type RefundPreview } from '@/lib/refund-policy';
import { cancelBooking, FunctionError, refundChanged } from '@/lib/functions-client';
import type { FetchedBooking } from '@/lib/functions-client';
import { clsx } from '@/lib/clsx';

interface Props {
  booking: FetchedBooking;
  /**
   * When the booking's departure leaves on its date, `HH:MM` marina time:
   * `slotStartTime(booking.timeSlot, booking.date)`, as cancelBooking uses.
   * The sunset cruise leaves at a different time each day.
   */
  tourStartTime: string;
  onClose: () => void;
  onCancelled: () => void;
}

const inputClass =
  'w-full rounded-lg border border-[var(--color-ink)]/20 bg-white px-3.5 py-3 text-base placeholder:text-[var(--color-ink-soft)]/60 focus:border-[var(--color-ink)] focus:outline-none focus:ring-2 focus:ring-[var(--color-spring)]/20';

export function CancelDialog({ booking, tourStartTime, onClose, onCancelled }: Props) {
  const preview = previewRefund({
    amountPaidCents: booking.amountPaidCents,
    amountRefundedCents: booking.amountRefundedCents,
    date: booking.date,
    startTime: tourStartTime,
  });
  // cancelBooking's own figure, once it has turned down a lower refund than
  // the one shown. From then on it's what the dialog shows and confirms.
  const [quoted, setQuoted] = useState<Pick<RefundPreview, 'tier' | 'refundCents' | 'explanation'> | null>(null);
  const shown = quoted ?? preview;
  const earlierRefund = booking.amountRefundedCents ?? 0;
  const leftCents = Math.max(0, booking.amountPaidCents - earlierRefund);
  const paid =
    earlierRefund > 0
      ? `you paid ${formatPrice(booking.amountPaidCents)}, and ${formatPrice(earlierRefund)} was already refunded`
      : `you paid ${formatPrice(booking.amountPaidCents)}`;
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, submitting]);

  async function confirm() {
    setSubmitting(true);
    setError(null);
    try {
      await cancelBooking({
        bookingId: booking.id,
        accessToken: booking.accessToken,
        reason: reason.trim() || undefined,
        // If the refund has dropped since (the 72-hour line passed while the
        // dialog was open), nothing is cancelled and we're told the new one.
        expectedRefundCents: shown.refundCents,
      });
      onCancelled();
    } catch (err) {
      const changed = refundChanged(err);
      if (changed) {
        setQuoted({
          tier: changed.policyTier === 'full' ? 'full' : 'none',
          refundCents: changed.refundCents,
          explanation: changed.explanation,
        });
      }
      setError(
        err instanceof FunctionError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Cancellation failed.',
      );
      setSubmitting(false);
    }
  }

  const tierColor =
    shown.tier === 'full' ? 'text-[var(--color-spring)]' : 'text-[var(--color-ink-soft)]';

  return (
    <div
      className="fixed inset-0 z-50 bg-[var(--color-ink)]/50 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={() => {
        // Not while cancelling: a failure message would be lost with it.
        if (!submitting) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="cancel-title"
    >
      <div
        className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 sm:p-7"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="cancel-title" className="text-2xl font-bold leading-tight">
          Cancel this booking?
        </h2>
        <p className="mt-2 text-sm text-[var(--color-ink-soft)]">
          {shown.explanation}
        </p>

        <div className="mt-4 rounded-2xl bg-[var(--color-paper)] p-4">
          <p className="text-label text-[var(--color-ink-soft)]">
            Refund
          </p>
          <p className={clsx('mt-1 text-display text-[2.25rem] tabular-nums', tierColor)}>
            {formatPrice(shown.refundCents)}
          </p>
          <p className="mt-1 text-xs text-[var(--color-ink-soft)]">
            {booking.amountPaidCents > 0 && leftCents === 0
              ? `Your payment has already been refunded.`
              : (
                <>
                  {shown.tier === 'full' &&
                    (earlierRefund > 0 ? `All that's left — ${paid}.` : `Full refund — ${paid}.`)}
                  {shown.tier === 'none' &&
                    (earlierRefund > 0
                      ? `None of the ${formatPrice(leftCents)} left is being refunded — ${paid}.`
                      : `You paid ${formatPrice(booking.amountPaidCents)} — none of that is being refunded.`)}
                  {' '}Funds typically appear in 3–5 business days.
                </>
              )}
          </p>
        </div>

        <label className="block mt-4">
          <span className="block text-sm font-medium text-[var(--color-ink)] mb-1">
            Reason{' '}
            <span className="text-[var(--color-ink-soft)] font-normal">(optional)</span>
          </span>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            maxLength={500}
            placeholder="What happened? Helpful but not required."
            className={inputClass}
          />
        </label>

        {error && (
          <div
            role="alert"
            className="mt-3 rounded-xl bg-[var(--color-error)]/5 border border-[var(--color-error)]/30 px-3 py-2 text-sm"
          >
            {error}
          </div>
        )}

        <div className="mt-5 flex flex-col-reverse sm:flex-row gap-3 sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-[10px] border border-[var(--color-ink)]/20 px-5 font-semibold text-[var(--color-ink)] hover:border-[var(--color-ink)] disabled:opacity-50"
          >
            Never mind
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={submitting}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-[10px] px-5 font-semibold bg-[var(--color-error)] text-white hover:bg-[#8f1e18] disabled:opacity-60"
          >
            {submitting
              ? 'Cancelling…'
              : shown.refundCents > 0
                ? `Cancel and refund ${formatPrice(shown.refundCents)}`
                : 'Confirm cancellation'}
          </button>
        </div>
      </div>
    </div>
  );
}

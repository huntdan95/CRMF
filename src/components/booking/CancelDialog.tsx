'use client';

import { useState } from 'react';
import { formatPrice } from '@/lib/tours';
import { previewRefund } from '@/lib/refund-policy';
import { cancelBooking, FunctionError } from '@/lib/functions-client';
import type { FetchedBooking } from '@/lib/functions-client';
import { clsx } from '@/lib/clsx';

interface Props {
  booking: FetchedBooking;
  /** Tour `startTime` in `HH:MM` from the static catalog. */
  tourStartTime: string;
  onClose: () => void;
  onCancelled: () => void;
}

const inputClass =
  'w-full rounded-2xl border border-[var(--color-ink)]/15 bg-white px-4 py-3 text-base placeholder:text-[var(--color-ink-soft)]/60 focus:border-[var(--color-brand-blue)] focus:outline-2 focus:outline-[var(--color-brand-blue)]/20';

export function CancelDialog({ booking, tourStartTime, onClose, onCancelled }: Props) {
  const preview = previewRefund({
    amountPaidCents: booking.amountPaidCents,
    date: booking.date,
    startTime: tourStartTime,
  });
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setSubmitting(true);
    setError(null);
    try {
      await cancelBooking({
        bookingId: booking.id,
        accessToken: booking.accessToken,
        reason: reason.trim() || undefined,
      });
      onCancelled();
    } catch (err) {
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
    preview.tier === 'full'
      ? 'text-[var(--color-brand-blue)]'
      : preview.tier === 'half'
        ? 'text-[var(--color-coral-dark)]'
        : 'text-[var(--color-ink-soft)]';

  return (
    <div
      className="fixed inset-0 z-50 bg-[var(--color-ink)]/40 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="cancel-title"
    >
      <div
        className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="cancel-title" className="font-display text-2xl leading-tight">
          Cancel this booking?
        </h2>
        <p className="mt-2 text-sm text-[var(--color-ink-soft)]">
          {preview.explanation}
        </p>

        <div className="mt-4 rounded-2xl bg-[var(--color-cream)] p-4">
          <p className="text-xs text-[var(--color-ink-soft)] uppercase tracking-widest">
            Refund
          </p>
          <p className={clsx('mt-1 font-display text-3xl', tierColor)}>
            {formatPrice(preview.refundCents)}
          </p>
          <p className="mt-1 text-xs text-[var(--color-ink-soft)]">
            {preview.tier === 'full' &&
              `Full refund — you paid ${formatPrice(booking.amountPaidCents)}.`}
            {preview.tier === 'half' &&
              `50% refund — you paid ${formatPrice(booking.amountPaidCents)}.`}
            {preview.tier === 'none' &&
              `You paid ${formatPrice(booking.amountPaidCents)} — none of that is being refunded.`}
            {' '}Funds typically appear in 3–5 business days.
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
            className="mt-3 rounded-2xl bg-[var(--color-coral)]/10 border border-[var(--color-coral)]/30 px-3 py-2 text-sm"
          >
            {error}
          </div>
        )}

        <div className="mt-5 flex flex-col-reverse sm:flex-row gap-3 sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="inline-flex items-center justify-center px-5 py-3 rounded-full border border-[var(--color-ink)]/15 text-[var(--color-ink)] hover:bg-[var(--color-ink)]/5 disabled:opacity-50"
          >
            Never mind
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={submitting}
            className="inline-flex items-center justify-center px-5 py-3 rounded-full bg-[var(--color-coral)] hover:bg-[var(--color-coral-dark)] text-white font-medium disabled:opacity-60"
          >
            {submitting
              ? 'Cancelling…'
              : preview.refundCents > 0
                ? `Cancel and refund ${formatPrice(preview.refundCents)}`
                : 'Confirm cancellation'}
          </button>
        </div>
      </div>
    </div>
  );
}

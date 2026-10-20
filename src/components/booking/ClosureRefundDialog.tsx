'use client';

import { useEffect, useState } from 'react';
import { cancelBooking, FunctionError, refundChanged, type FetchedBooking } from '@/lib/functions-client';
import { formatPrice } from '@/lib/tours';
import { useDialogFocus } from './useDialogFocus';

interface Props {
  booking: FetchedBooking;
  onClose: () => void;
  /** Done: what the page should tell them. */
  onRefunded: (message: string) => void;
}

/**
 * Taking the refund instead of a new date, on a booking Travis closed. Always
 * in full (the cancellation policy's windows don't apply to his closures);
 * money paid on the old website is refunded by Travis himself.
 */
export function ClosureRefundDialog({ booking, onClose, onRefunded }: Props) {
  const owed = Math.max(0, booking.amountPaidCents - (booking.amountRefundedCents ?? 0));
  const oldSite = booking.id.startsWith('legacy-');
  // cancelBooking's policy refund, once it has turned down the full one: the
  // closure came off before they confirmed (Travis reopened the departure, or
  // the booking was moved), so the usual policy applies again.
  const [quoted, setQuoted] = useState<{ refundCents: number; explanation: string } | null>(null);
  const refundCents = quoted?.refundCents ?? owed;
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { boxRef, headingRef, trapFocus } = useDialogFocus();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, submitting]);

  const what = quoted
    ? `Your booking isn’t closed any more, so the usual cancellation policy applies. ${quoted.explanation} ${
        quoted.refundCents > 0
          ? `${formatPrice(quoted.refundCents)} would go back to your card.`
          : 'Nothing would be refunded.'
      } Confirm again to cancel on those terms, or go back and reload the page to see where it stands now.`
    : owed === 0
      ? booking.amountPaidCents > 0
        ? 'Your payment has already been refunded, so there’s nothing more to pay back.'
        : 'You haven’t been charged, so there’s nothing to pay back.'
      : oldSite
        ? `You booked on our old website, so Travis refunds your ${formatPrice(owed)} himself. He’ll be in touch.`
        : `${formatPrice(owed)} goes back to your card in full. It usually shows up in 5–10 business days.`;

  async function confirm() {
    setSubmitting(true);
    setError(null);
    try {
      const r = await cancelBooking({
        bookingId: booking.id,
        accessToken: booking.accessToken,
        // A closure refund is in full whatever this says. But if the closure
        // has come off since the page loaded, cancelBooking falls back to the
        // policy, and this stops it cancelling for less than we showed
        // (nothing, close to the day): it answers with the new refund instead.
        // Old-site bookings can't be cancelled under the policy online at all.
        expectedRefundCents: oldSite ? undefined : refundCents,
      });
      onRefunded(
        r.alreadyCancelled
          ? 'This booking was already cancelled.'
          : (r.manualRefundCents ?? 0) > 0
            ? `Cancelled. Travis will be in touch about your ${formatPrice(r.manualRefundCents!)} refund.`
            : (r.refundCents ?? 0) > 0
              ? `Cancelled. ${formatPrice(r.refundCents!)} is on its way back to your card. Watch your email for the receipt.`
              : booking.amountPaidCents === 0
                ? 'Cancelled. Nothing was charged, so there’s no refund to wait for.'
                : owed === 0
                  ? 'Cancelled. Your payment had already been refunded.'
                  : 'Cancelled, with no refund under the cancellation policy. Watch your email for the confirmation.',
      );
    } catch (err) {
      const changed = refundChanged(err);
      if (changed) setQuoted({ refundCents: changed.refundCents, explanation: changed.explanation });
      setError(
        err instanceof FunctionError
          ? err.message
          : 'We couldn’t reach the booking system. Check your connection and try again.',
      );
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-[var(--color-ink)]/50 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={() => {
        if (!submitting) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="closure-refund-title"
    >
      <div
        ref={boxRef}
        onKeyDown={trapFocus}
        className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 sm:p-7"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 ref={headingRef} tabIndex={-1} id="closure-refund-title" className="text-2xl font-bold leading-tight outline-none">
          {refundCents > 0 ? 'Cancel and refund?' : 'Cancel this booking?'}
        </h2>
        <p className="mt-3 text-sm">{what}</p>

        {error && (
          <div
            role="alert"
            className="mt-4 rounded-xl bg-[var(--color-error)]/5 border border-[var(--color-error)]/30 px-3 py-2 text-sm"
          >
            {error}
          </div>
        )}

        <div className="mt-6 flex flex-col-reverse sm:flex-row gap-3 sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-[10px] border border-[var(--color-ink)]/20 px-5 font-semibold text-[var(--color-ink)] hover:border-[var(--color-ink)] disabled:opacity-50"
          >
            Go back
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={submitting}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-[10px] px-5 font-semibold bg-[var(--color-error)] text-white hover:bg-[#8f1e18] disabled:opacity-60"
          >
            {submitting ? 'Cancelling…' : refundCents > 0 ? 'Cancel and refund me' : 'Cancel booking'}
          </button>
        </div>
      </div>
    </div>
  );
}

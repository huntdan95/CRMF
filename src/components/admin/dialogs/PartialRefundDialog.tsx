'use client';

import { useState } from 'react';
import { AdminModal, adminInputClass } from './AdminModal';
import { admin } from '@/lib/admin-client';
import { FunctionError } from '@/lib/functions-client';
import { formatPrice } from '@/lib/tours';
import type { BookingDoc } from '@/lib/admin-firestore';

interface Props {
  booking: BookingDoc;
  onClose: () => void;
  onDone: (amountCents: number) => void;
}

export function PartialRefundDialog({ booking, onClose, onDone }: Props) {
  const refundable = Math.max(
    0,
    booking.amountPaidCents - booking.amountRefundedCents,
  );
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  // Money leaves the account on the second tap, after Travis has seen the
  // amount in words. A typo like "250" for "25.0" is caught here.
  const [confirmCents, setConfirmCents] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Sent with every try from this window, so a retry after a dropped
  // connection can't refund twice.
  const [requestId] = useState(() => crypto.randomUUID());

  function review() {
    setError(null);
    const dollars = Number.parseFloat(amount);
    if (!Number.isFinite(dollars) || dollars <= 0) {
      setError('Type how much to refund, for example 25 or 25.50.');
      return;
    }
    const cents = Math.round(dollars * 100);
    if (cents > refundable) {
      setError(`That’s more than they paid. The most you can refund is ${formatPrice(refundable)}.`);
      return;
    }
    setConfirmCents(cents);
  }

  async function submit(cents: number) {
    setBusy(true);
    setError(null);
    try {
      const result = await admin.partialRefund(booking.id, cents, requestId, reason.trim() || undefined);
      onDone(result.refundCents);
    } catch (err) {
      setError(
        err instanceof FunctionError
          ? err.message
          : 'Couldn’t reach the server, so the refund may or may not have gone through. Tap the button again: it won’t refund twice.',
      );
      setBusy(false);
    }
  }

  return (
    <AdminModal title="Refund part of the payment" onClose={onClose} busy={busy}>
      {confirmCents === null ? (
        <>
          <p className="text-sm text-[var(--color-ink-soft)]">
            The money goes back to the card {booking.customerName} paid with.
            The booking stays on the calendar.
          </p>

          <label className="block mt-4">
            <span className="block text-sm font-medium text-[var(--color-ink)] mb-1">
              How much to refund ($)
            </span>
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0.01"
              max={(refundable / 100).toFixed(2)}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className={adminInputClass}
              placeholder="0.00"
            />
            <p className="mt-1 text-xs text-[var(--color-ink-soft)]">
              They paid {formatPrice(booking.amountPaidCents)}
              {booking.amountRefundedCents > 0 && (
                <>, and {formatPrice(booking.amountRefundedCents)} has already been refunded</>
              )}
              . You can refund up to {formatPrice(refundable)}.
            </p>
          </label>

          <label className="block mt-3">
            <span className="block text-sm font-medium text-[var(--color-ink)] mb-1">
              Why?{' '}
              <span className="text-[var(--color-ink-soft)] font-normal">
                (optional, only you see this)
              </span>
            </span>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
              placeholder="Late guest, weather, etc."
              className={adminInputClass}
            />
          </label>
        </>
      ) : (
        <div className="rounded-2xl bg-[var(--color-cream)] p-4">
          <p className="text-sm">Refund</p>
          <p className="font-display text-3xl text-[var(--color-brand-blue)] tabular-nums">
            {formatPrice(confirmCents)}
          </p>
          <p className="text-sm mt-1">
            to {booking.customerName}’s card? This can’t be undone.
          </p>
        </div>
      )}

      {error && (
        <div role="alert" className="mt-3 rounded-2xl bg-[var(--color-coral)]/10 border border-[var(--color-coral)]/30 px-3 py-2 text-sm">
          {error}
        </div>
      )}

      <div className="mt-5 flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
        <button
          type="button"
          onClick={confirmCents === null ? onClose : () => setConfirmCents(null)}
          disabled={busy}
          className="px-4 py-3 sm:py-2 rounded-[10px] border border-[var(--color-ink)]/15 hover:bg-[var(--color-ink)]/5 disabled:opacity-60"
        >
          {confirmCents === null ? 'Never mind' : 'Go back'}
        </button>
        <button
          type="button"
          onClick={confirmCents === null ? review : () => submit(confirmCents)}
          disabled={busy}
          className="px-4 py-3 sm:py-2 rounded-[10px] bg-[var(--color-brand-blue)] hover:bg-[var(--color-brand-blue-dark)] text-white font-medium disabled:opacity-60"
        >
          {busy
            ? 'Refunding…'
            : confirmCents === null
              ? 'Next'
              : `Yes, refund ${formatPrice(confirmCents)}`}
        </button>
      </div>
    </AdminModal>
  );
}

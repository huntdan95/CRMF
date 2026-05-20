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
  onDone: () => void;
}

export function CancelAdminDialog({ booking, onClose, onDone }: Props) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const owed = Math.max(0, booking.amountPaidCents - booking.amountRefundedCents);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await admin.cancelBooking(booking.id, reason.trim() || undefined);
      onDone();
    } catch (err) {
      setError(err instanceof FunctionError ? err.message : 'Failed to cancel.');
      setBusy(false);
    }
  }

  return (
    <AdminModal title="Cancel + full refund" onClose={onClose}>
      <p className="text-sm text-[var(--color-ink-soft)]">
        Travis-cancelled bookings always refund the full remaining amount.
        Customer will be emailed.
      </p>
      <div className="mt-4 rounded-2xl bg-[var(--color-cream)] p-4">
        <p className="text-xs text-[var(--color-ink-soft)] uppercase tracking-widest">
          Refund
        </p>
        <p className="mt-1 font-display text-2xl text-[var(--color-brand-blue)]">
          {formatPrice(owed)}
        </p>
        <p className="text-xs text-[var(--color-ink-soft)] mt-1">
          Customer paid {formatPrice(booking.amountPaidCents)}
          {booking.amountRefundedCents > 0 && (
            <>, prior refunds {formatPrice(booking.amountRefundedCents)}</>
          )}.
        </p>
      </div>

      <label className="block mt-4">
        <span className="block text-sm font-medium text-[var(--color-ink)] mb-1">
          Reason{' '}
          <span className="text-[var(--color-ink-soft)] font-normal">
            (shown to customer)
          </span>
        </span>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          maxLength={500}
          placeholder="Weather, mechanical, personal, etc."
          className={adminInputClass}
        />
      </label>

      {error && (
        <div className="mt-3 rounded-2xl bg-[var(--color-coral)]/10 border border-[var(--color-coral)]/30 px-3 py-2 text-sm">
          {error}
        </div>
      )}

      <div className="mt-5 flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          className="px-4 py-2 rounded-full border border-[var(--color-ink)]/15 hover:bg-[var(--color-ink)]/5 disabled:opacity-60"
        >
          Never mind
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={busy}
          className="px-4 py-2 rounded-full bg-[var(--color-coral)] hover:bg-[var(--color-coral-dark)] text-white font-medium disabled:opacity-60"
        >
          {busy ? 'Cancelling…' : `Cancel and refund ${formatPrice(owed)}`}
        </button>
      </div>
    </AdminModal>
  );
}

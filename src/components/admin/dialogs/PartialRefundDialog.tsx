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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    const dollars = Number.parseFloat(amount);
    if (!Number.isFinite(dollars) || dollars <= 0) {
      setError('Enter a positive dollar amount.');
      return;
    }
    const cents = Math.round(dollars * 100);
    if (cents > refundable) {
      setError(`Cannot refund more than ${formatPrice(refundable)}.`);
      return;
    }
    setBusy(true);
    try {
      await admin.partialRefund(booking.id, cents, reason.trim() || undefined);
      onDone(cents);
    } catch (err) {
      setError(err instanceof FunctionError ? err.message : 'Refund failed.');
      setBusy(false);
    }
  }

  return (
    <AdminModal title="Partial refund" onClose={onClose}>
      <p className="text-sm text-[var(--color-ink-soft)]">
        Refunds back to the customer&rsquo;s original payment method. Booking
        stays active.
      </p>

      <label className="block mt-4">
        <span className="block text-sm font-medium text-[var(--color-ink)] mb-1">
          Amount (USD)
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
          placeholder={(refundable / 100).toFixed(2)}
        />
        <p className="mt-1 text-xs text-[var(--color-ink-soft)]">
          Up to {formatPrice(refundable)} available.
        </p>
      </label>

      <label className="block mt-3">
        <span className="block text-sm font-medium text-[var(--color-ink)] mb-1">
          Reason{' '}
          <span className="text-[var(--color-ink-soft)] font-normal">
            (audit log only)
          </span>
        </span>
        <input
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={500}
          placeholder="Late guest, weather refund, etc."
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
          className="px-4 py-2 rounded-full border border-[var(--color-ink)]/15 hover:bg-[var(--color-ink)]/5"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={busy}
          className="px-4 py-2 rounded-full bg-[var(--color-brand-blue)] hover:bg-[var(--color-brand-blue-dark)] text-white font-medium disabled:opacity-60"
        >
          {busy ? 'Refunding…' : 'Issue refund'}
        </button>
      </div>
    </AdminModal>
  );
}

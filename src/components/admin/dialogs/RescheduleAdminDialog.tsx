'use client';

import { useState } from 'react';
import { AdminModal, adminInputClass } from './AdminModal';
import { admin } from '@/lib/admin-client';
import { FunctionError } from '@/lib/functions-client';
import { tours } from '@/lib/tours';
import { isoDate, startOfDay } from '@/lib/date';
import type { BookingDoc } from '@/lib/admin-firestore';

interface Props {
  booking: BookingDoc;
  onClose: () => void;
  onDone: () => void;
}

export function RescheduleAdminDialog({ booking, onClose, onDone }: Props) {
  const today = isoDate(startOfDay(new Date()));
  const [newDate, setNewDate] = useState(booking.date);
  const [newSlug, setNewSlug] = useState(booking.tourId);
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      await admin.rescheduleBooking(booking.id, newDate, newSlug, notify);
      onDone();
    } catch (err) {
      setError(
        err instanceof FunctionError ? err.message : 'Reschedule failed.',
      );
      setBusy(false);
    }
  }

  return (
    <AdminModal title="Reschedule booking" onClose={onClose}>
      <p className="text-sm text-[var(--color-ink-soft)]">
        Capacity is re-checked on save. Price differences are handled manually
        in v1 — do partial refunds or extra Stripe charges from the Stripe
        dashboard if the new tour costs less or more.
      </p>

      <label className="block mt-4">
        <span className="block text-sm font-medium mb-1">New date</span>
        <input
          type="date"
          value={newDate}
          min={today}
          onChange={(e) => setNewDate(e.target.value)}
          className={adminInputClass}
        />
      </label>

      <label className="block mt-3">
        <span className="block text-sm font-medium mb-1">New tour</span>
        <select
          value={newSlug}
          onChange={(e) => setNewSlug(e.target.value)}
          className={adminInputClass}
        >
          {tours.filter((t) => t.active).map((t) => (
            <option key={t.slug} value={t.slug}>
              {t.name} ({t.startTimeDisplay})
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-center gap-2 mt-4 text-sm">
        <input
          type="checkbox"
          checked={notify}
          onChange={(e) => setNotify(e.target.checked)}
          className="w-4 h-4"
        />
        Email the customer the updated booking
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
          {busy ? 'Saving…' : 'Reschedule'}
        </button>
      </div>
    </AdminModal>
  );
}

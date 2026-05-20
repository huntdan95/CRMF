'use client';

import { useState } from 'react';
import {
  requestReschedule,
  FunctionError,
} from '@/lib/functions-client';
import type { FetchedBooking } from '@/lib/functions-client';
import { isoDate, startOfDay } from '@/lib/date';
import { slotLabels, slotOrder } from '@/lib/tours';
import type { TourTimeSlot } from '@/lib/tours';

interface Props {
  booking: FetchedBooking;
  onClose: () => void;
  onSubmitted: () => void;
}

const inputClass =
  'w-full rounded-2xl border border-[var(--color-ink)]/15 bg-white px-4 py-3 text-base placeholder:text-[var(--color-ink-soft)]/60 focus:border-[var(--color-brand-blue)] focus:outline-2 focus:outline-[var(--color-brand-blue)]/20';

export function RescheduleDialog({ booking, onClose, onSubmitted }: Props) {
  const today = isoDate(startOfDay(new Date()));
  const [date, setDate] = useState<string>('');
  const [slot, setSlot] = useState<TourTimeSlot | ''>('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!date) {
      setError('Please pick a preferred date.');
      return;
    }
    setSubmitting(true);
    try {
      await requestReschedule({
        bookingId: booking.id,
        accessToken: booking.accessToken,
        requestedDate: date,
        requestedSlot: slot || undefined,
        notes: notes.trim() || undefined,
      });
      onSubmitted();
    } catch (err) {
      setError(
        err instanceof FunctionError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Could not send the request.',
      );
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-[var(--color-ink)]/40 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="reschedule-title"
    >
      <form
        onSubmit={submit}
        className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="reschedule-title" className="font-display text-2xl leading-tight">
          Request a different date
        </h2>
        <p className="mt-2 text-sm text-[var(--color-ink-soft)]">
          Travis confirms reschedules personally — he&rsquo;ll email you back
          within a day. Your existing booking stays as-is until then.
        </p>

        <label className="block mt-4">
          <span className="block text-sm font-medium text-[var(--color-ink)] mb-1">
            Preferred date <span className="text-[var(--color-coral-dark)]">*</span>
          </span>
          <input
            type="date"
            value={date}
            min={today}
            onChange={(e) => setDate(e.target.value)}
            required
            className={inputClass}
          />
        </label>

        <label className="block mt-3">
          <span className="block text-sm font-medium text-[var(--color-ink)] mb-1">
            Preferred slot{' '}
            <span className="text-[var(--color-ink-soft)] font-normal">(optional)</span>
          </span>
          <select
            value={slot}
            onChange={(e) => setSlot(e.target.value as TourTimeSlot | '')}
            className={inputClass}
          >
            <option value="">No preference</option>
            {slotOrder.map((s) => (
              <option key={s} value={s}>
                {slotLabels[s]}
              </option>
            ))}
            <option value="whole-day">Whole-day private</option>
          </select>
        </label>

        <label className="block mt-3">
          <span className="block text-sm font-medium text-[var(--color-ink)] mb-1">
            Notes{' '}
            <span className="text-[var(--color-ink-soft)] font-normal">(optional)</span>
          </span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            maxLength={1000}
            placeholder="Flexible weekend, kid's birthday, etc."
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
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex items-center justify-center px-5 py-3 rounded-full bg-[var(--color-coral)] hover:bg-[var(--color-coral-dark)] text-white font-medium disabled:opacity-60"
          >
            {submitting ? 'Sending…' : 'Send request'}
          </button>
        </div>
      </form>
    </div>
  );
}

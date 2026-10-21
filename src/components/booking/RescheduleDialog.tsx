'use client';

import { useEffect, useState } from 'react';
import { useDialogFocus } from './useDialogFocus';
import {
  requestReschedule,
  FunctionError,
} from '@/lib/functions-client';
import type { FetchedBooking } from '@/lib/functions-client';
import { marinaNow, seasonWords } from '@/lib/availability';
import { slotRunsOn } from '@/lib/schedule';
import { slotLabels, slotOrder } from '@/lib/tours';
import type { TourTimeSlot } from '@/lib/tours';

interface Props {
  booking: FetchedBooking;
  onClose: () => void;
  onSubmitted: () => void;
}

const inputClass =
  'w-full rounded-lg border border-[var(--color-ink)]/20 bg-white px-3.5 py-3 text-base placeholder:text-[var(--color-ink-soft)]/60 focus:border-[var(--color-ink)] focus:outline-none focus:ring-2 focus:ring-[var(--color-spring)]/20';

export function RescheduleDialog({ booking, onClose, onSubmitted }: Props) {
  const { boxRef, headingRef, trapFocus } = useDialogFocus();
  // Today at the marina, not wherever the customer's phone is.
  const today = marinaNow().date;
  const [date, setDate] = useState<string>('');
  const [slot, setSlot] = useState<TourTimeSlot | ''>('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A cruise moves to another cruise, so only to a date it runs
  // (requestReschedule turns the rest away with the same words).
  const cruiseSeason = booking.timeSlot === 'sunset' ? seasonWords('sunset') : null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, submitting]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!date) {
      setError('Please pick a preferred date.');
      return;
    }
    if (cruiseSeason && !slotRunsOn('sunset', date)) {
      setError(`The sunset cruise runs ${cruiseSeason}. Pick a date in the season, or call Travis.`);
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

  // Centred with my-auto, not items-center (as AdminModal is): on a short
  // phone screen a box taller than it would spill off the top, where it
  // can't be scrolled to. This way it starts at the top and scrolls.
  return (
    <div
      className="fixed inset-0 z-50 bg-[var(--color-ink)]/50 backdrop-blur-sm flex justify-center p-4 overflow-y-auto"
      onClick={() => {
        // Not while sending: the result (or error) would be lost with it.
        if (!submitting) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="reschedule-title"
    >
      <div
        ref={boxRef}
        onKeyDown={trapFocus}
        className="bg-white rounded-2xl shadow-2xl max-w-md w-full my-auto p-6 sm:p-7"
        onClick={(e) => e.stopPropagation()}
      >
        <form onSubmit={submit}>
          <h2 ref={headingRef} tabIndex={-1} id="reschedule-title" className="text-2xl font-bold leading-tight outline-none">
            Request a different date
          </h2>
          <p className="mt-2 text-sm text-[var(--color-ink-soft)]">
            Travis confirms reschedules personally — he&rsquo;ll email you back
            within a day. Your existing booking stays as-is until then.
          </p>

          <label className="block mt-4">
            <span className="block text-sm font-medium text-[var(--color-ink)] mb-1">
              Preferred date <span className="text-[var(--color-buoy-deep)]">*</span>
            </span>
            <input
              type="date"
              value={date}
              min={today}
              onChange={(e) => setDate(e.target.value)}
              required
              aria-describedby={cruiseSeason ? 'reschedule-season' : undefined}
              className={inputClass}
            />
          </label>
          {cruiseSeason && (
            <p id="reschedule-season" className="mt-1 text-xs text-[var(--color-ink-soft)]">
              The sunset cruise runs {cruiseSeason}.
            </p>
          )}

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
              {booking.timeSlot === 'sunset' ? (
                // A cruise moves to another cruise.
                <option value="sunset">{slotLabels.sunset}</option>
              ) : (
                <>
                  {slotOrder.map((s) => (
                    <option key={s} value={s}>
                      {slotLabels[s]}
                    </option>
                  ))}
                  <option value="whole-day">Whole-day private</option>
                </>
              )}
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
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-[10px] px-5 font-semibold bg-[var(--color-buoy)] text-[var(--color-ink)] hover:bg-[var(--color-buoy-deep)] disabled:opacity-60"
            >
              {submitting ? 'Sending…' : 'Send request'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

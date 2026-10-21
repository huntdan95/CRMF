'use client';

import { useEffect, useState } from 'react';
import { AdminModal } from './AdminModal';
import { inputClass } from '../ui';
import { departureTime } from '../booking-labels';
import { admin } from '@/lib/admin-client';
import { listAllTours } from '@/lib/admin-firestore';
import { FunctionError } from '@/lib/functions-client';
import { marinaNow } from '@/lib/availability';
import type { BookingDoc } from '@/lib/admin-firestore';

interface Props {
  booking: BookingDoc;
  onClose: () => void;
  /**
   * Called with a plain sentence saying what happened, and `err` when the
   * email didn't send, so it stays until it's read.
   */
  onDone: (message: string, kind: 'ok' | 'err') => void;
}

interface TourOption {
  slug: string;
  name: string;
  timeSlot: string;
  /** `HH:MM`, for the order; the booking's own tour may not have one. */
  startTime?: string;
  type: string;
}

type TourRow = Awaited<ReturnType<typeof listAllTours>>[number];
type Moved = Awaited<ReturnType<typeof admin.rescheduleBooking>>;

function movedMessage(r: Moved, firstName: string, emailable: boolean): string {
  if (r.emailed) return `Booking moved. ${firstName} has been emailed the new date and time.`;
  if (r.reason === 'failed') return `Booking moved, but the email to ${firstName} didn’t send, so call or text them.`;
  // Unticked. A booking the dialog can't email goes unticked too, and they
  // still need telling.
  if (r.reason === 'not-asked' && emailable) return `Booking moved. ${firstName} was not emailed.`;
  return `Booking moved. ${firstName} wasn’t emailed, so call or text them the new date and time.`;
}

export function RescheduleAdminDialog({ booking, onClose, onDone }: Props) {
  const today = marinaNow().date;
  const firstName = booking.customerName.split(' ')[0] || 'the customer';
  // The updated confirmation says the tour is "locked in", so the server
  // only sends it for a confirmed booking, which an old-site reservation isn't.
  const emailable = booking.status === 'confirmed' && !!booking.customerEmail;
  // They paid sales tax on top of the old price: refunding only the
  // difference in price would leave the tax on it with Travis.
  const taxed = (booking.salesTaxCents ?? 0) > 0;
  // An old booking's date is in the past, which the date picker won't accept.
  const [newDate, setNewDate] = useState(booking.date >= today ? booking.date : today);
  const [newSlug, setNewSlug] = useState(booking.tourId);
  const [notify, setNotify] = useState(emailable);
  const [catalog, setCatalog] = useState<TourRow[] | null>(null);
  const [catalogFailed, setCatalogFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The tours as Travis has them in Admin → Tours: the built-in list doesn't
  // know which he's switched on (the sunset cruise is off there).
  useEffect(() => {
    let live = true;
    listAllTours().then(
      (list) => {
        if (live) setCatalog(list);
      },
      () => {
        if (live) setCatalogFailed(true);
      },
    );
    return () => {
      live = false;
    };
  }, []);

  // Tours on sale, plus the booking's own even if it's been switched off
  // since, so the picker starts on the tour the booking is really on.
  const options: TourOption[] = (catalog ?? [])
    .filter((t) => t.active || t.slug === booking.tourId)
    .sort((a, b) => (a.startTime ?? '').localeCompare(b.startTime ?? '') || a.type.localeCompare(b.type));
  if (!options.some((t) => t.slug === booking.tourId)) {
    options.unshift({ slug: booking.tourId, name: booking.tourName, timeSlot: booking.timeSlot, type: booking.type });
  }

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      const r = await admin.rescheduleBooking(booking.id, newDate, newSlug, emailable && notify);
      onDone(movedMessage(r, firstName, emailable), r.reason === 'failed' ? 'err' : 'ok');
    } catch (err) {
      setError(
        err instanceof FunctionError
          ? err.message
          : 'That didn’t save. The booking hasn’t changed. Try again in a minute.',
      );
      setBusy(false);
    }
  }

  return (
    <AdminModal title="Move to another day or tour" onClose={onClose} busy={busy}>
      <p className="text-sm text-[var(--color-ink-soft)]">
        If the new tour is full, you’ll be told and nothing changes. The price
        isn’t adjusted: if the new tour costs less, refund the difference
        {taxed ? ' plus its 6% sales tax' : ''} with “Refund part of the
        payment”{taxed ? ', which adds the tax for you' : ''}.
      </p>

      <label className="block mt-4">
        <span className="block text-sm font-medium mb-1">New date</span>
        <input
          type="date"
          value={newDate}
          min={today}
          onChange={(e) => setNewDate(e.target.value)}
          className={inputClass}
        />
      </label>

      <label className="block mt-3">
        <span className="block text-sm font-medium mb-1">New tour</span>
        <select
          value={newSlug}
          onChange={(e) => setNewSlug(e.target.value)}
          className={inputClass}
        >
          {options.map((t) => (
            <option key={t.slug} value={t.slug}>
              {t.name} ({departureTime({ timeSlot: t.timeSlot, date: newDate })})
            </option>
          ))}
        </select>
        {!catalog && (
          <span className="block text-xs text-[var(--color-ink-soft)] mt-1.5">
            {catalogFailed
              ? 'Couldn’t load the other tours, so only the date can change. Close this and try again for a different tour.'
              : 'Loading the other tours…'}
          </span>
        )}
      </label>

      {emailable ? (
        <label className="flex items-center gap-2 mt-4 text-sm">
          <input
            type="checkbox"
            checked={notify}
            onChange={(e) => setNotify(e.target.checked)}
            className="w-5 h-5"
          />
          Email {booking.customerName} the new date and time
        </label>
      ) : (
        <p className="mt-4 text-sm">
          {booking.status === 'confirmed'
            ? `There’s no email address on this booking, so call or text ${firstName} the new date and time.`
            : `${firstName} won’t be emailed: the booking was reserved on the old website and isn’t confirmed here. Call or text them the new date and time.`}
        </p>
      )}

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
          className="px-4 py-3 sm:py-2 rounded-[10px] border border-[var(--color-ink)]/15 hover:bg-[var(--color-ink)]/5"
        >
          Never mind
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={busy}
          className="px-4 py-3 sm:py-2 rounded-[10px] bg-[var(--color-brand-blue)] hover:bg-[var(--color-brand-blue-dark)] text-white font-medium disabled:opacity-60"
        >
          {busy ? 'Moving…' : 'Move booking'}
        </button>
      </div>
    </AdminModal>
  );
}

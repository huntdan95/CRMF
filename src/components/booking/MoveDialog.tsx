'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  addDaysIso,
  marinaNow,
  matchesKind,
  statusLabel,
  tourStatus,
  type TourKind,
} from '@/lib/availability';
import { moveClosedBooking, FunctionError, type FetchedBooking } from '@/lib/functions-client';
import { formatFriendlyDate } from '@/lib/date';
import { departureTimes, type MarketingTour } from '@/lib/tours';
import { totalOn } from '@/lib/pricing';
import { siteConfig } from '@/lib/site-config';
import { useTourCatalog } from '@/components/TourCatalog';
import { clsx } from '@/lib/clsx';
import { AvailabilityCalendar } from './AvailabilityCalendar';
import { useAvailability } from './useAvailability';
import { useDialogFocus } from './useDialogFocus';

interface Props {
  booking: FetchedBooking;
  onClose: () => void;
  /** Moved: the new date and departure, for the page to say so. */
  onMoved: (date: string, departs: string) => void;
}

/**
 * Picking another date for a booking Travis closed. Same kind of tour,
 * any open departure; the move happens straight away (moveClosedBooking),
 * with the server re-checking seats and price.
 */
export function MoveDialog({ booking, onClose, onMoved }: Props) {
  const { tours, seasons } = useTourCatalog();
  const [now] = useState(() => marinaNow());
  const today = now.date;
  const maxDate = addDaysIso(today, 365);
  const kind: TourKind = booking.timeSlot === 'whole-day' ? 'whole-day' : booking.type;
  const guests = Math.max(1, booking.guestCount);
  // The old site didn't always record party size; seats can't be counted.
  const unknownParty = booking.type === 'shared' && booking.guestCount < 1;

  const [date, setDate] = useState<string | null>(null);
  const [slug, setSlug] = useState<string | null>(null);
  const [view, setView] = useState(() => {
    const [y, m] = today.split('-').map(Number) as [number, number];
    return { year: y, month0: m - 1 };
  });
  const { getDay, isPending, loading, invalidate } = useAvailability(view.year, view.month0, date);
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

  const day = date ? getDay(date) : undefined;
  const pending = !!date && !day && isPending(date);
  // Same kind of trip, and a cruise only moves to another cruise (the
  // server's sameKind rule). The calendar colours days by these too.
  const options = useMemo(
    () =>
      tours.filter(
        (t) => t.active && matchesKind(t, kind) && (t.timeSlot === 'sunset') === (booking.timeSlot === 'sunset'),
      ),
    [tours, kind, booking.timeSlot],
  );
  const chosen = options.find((t) => t.slug === slug) ?? null;
  // The server won't move a booking into a departure priced higher than the
  // one that was closed (a holiday rate, say); Travis sorts those out by
  // phone. Same comparison as moveClosedBooking, which prices the closed
  // booking as the new tour when its own tour is gone.
  const oldTour = tours.find((t) => t.slug === booking.tourId);
  const pricedHigher = (tour: MarketingTour, on: string) =>
    totalOn(tour, guests, on, seasons) > totalOn(oldTour ?? tour, guests, booking.date, seasons);
  // "Sat, Nov 14": the button has to fit a phone.
  const shortDate = date
    ? new Date(`${date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
    : '';

  async function submit() {
    if (!date || !chosen) return;
    setSubmitting(true);
    setError(null);
    try {
      await moveClosedBooking({
        bookingId: booking.id,
        accessToken: booking.accessToken,
        newDate: date,
        newTourSlug: chosen.slug,
      });
      onMoved(date, departureTimes(chosen, date).start);
    } catch (err) {
      setError(
        err instanceof FunctionError
          ? err.message
          : 'We couldn’t reach the booking system. Check your connection and try again.',
      );
      // Seats may have changed under us.
      invalidate();
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
      aria-labelledby="move-title"
    >
      <div
        ref={boxRef}
        onKeyDown={trapFocus}
        className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[92vh] overflow-y-auto p-5 sm:p-7"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 ref={headingRef} tabIndex={-1} id="move-title" className="text-2xl font-bold leading-tight outline-none">
          Pick a new date
        </h2>
        <p className="mt-2 text-sm text-[var(--color-ink-soft)]">
          {/* No seat count to quote without a party size (Travis moves those). */}
          {unknownParty
            ? 'Same tour, no charge.'
            : `Same tour, ${booking.type === 'shared' ? `${guests} ${guests === 1 ? 'seat' : 'seats'}` : 'the whole boat'}, no charge. Your booking moves as soon as you confirm.`}
        </p>

        {unknownParty ? (
          <p className="mt-5 rounded-xl bg-[var(--color-paper)] border border-[var(--color-sand)] p-4 text-sm">
            We don&rsquo;t have your party size on file, so we can&rsquo;t check seats online. Call or text Travis at{' '}
            <a href={siteConfig.contact.phoneHref} className="font-medium underline underline-offset-2">
              {siteConfig.contact.phone}
            </a>{' '}
            and he&rsquo;ll move you.
          </p>
        ) : (
          <>
            <div className="mt-5">
              <AvailabilityCalendar
                year={view.year}
                month0={view.month0}
                onMonthChange={(year, month0) => setView({ year, month0 })}
                selected={date}
                onSelect={(d) => {
                  setDate(d);
                  setSlug(null);
                  setError(null);
                }}
                getDay={getDay}
                guests={guests}
                kind={kind}
                catalog={options}
                today={today}
                now={now}
                maxDate={maxDate}
                loading={loading}
              />
            </div>

            {date && (
              <fieldset className="mt-5">
                <legend className="text-sm font-semibold">{formatFriendlyDate(date)}</legend>
                <div className="mt-2 grid gap-2">
                  {options.map((tour) => {
                    const status = tourStatus(tour, day, guests, { date, now });
                    const closedOne = date === booking.date && tour.timeSlot === booking.timeSlot;
                    const dearer = pricedHigher(tour, date);
                    const disabled = closedOne || !status.bookable || dearer;
                    return (
                      <label
                        key={tour.slug}
                        className={clsx(
                          'flex items-center justify-between gap-3 rounded-lg border px-3.5 py-3 text-sm transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--color-spring)]',
                          slug === tour.slug
                            ? 'border-[var(--color-ink)] bg-[var(--color-ink)] text-white'
                            : disabled
                              ? 'cursor-not-allowed border-transparent bg-[var(--color-paper)] text-[var(--color-ink-soft)]'
                              : 'cursor-pointer border-[var(--color-sand)] hover:border-[var(--color-ink)]/50',
                        )}
                      >
                        <input
                          type="radio"
                          name="new-departure"
                          value={tour.slug}
                          checked={slug === tour.slug}
                          disabled={disabled}
                          onChange={() => setSlug(tour.slug)}
                          className="sr-only"
                        />
                        <span className="font-semibold tabular-nums">
                          {departureTimes(tour, date).start} – {departureTimes(tour, date).end}
                        </span>
                        <span className={clsx(pending && 'animate-pulse')}>
                          {closedOne
                            ? 'The one that was closed'
                            : pending
                              ? 'Checking seats…'
                              : status.bookable && dearer
                                ? 'Priced higher: call Travis'
                                : statusLabel(status, tour)}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            )}
          </>
        )}

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
            Not now
          </button>
          {!unknownParty && (
            <button
              type="button"
              onClick={submit}
              disabled={submitting || !date || !chosen}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[10px] px-5 py-2 font-semibold bg-[var(--color-buoy)] text-[var(--color-ink)] hover:bg-[var(--color-buoy-deep)] disabled:opacity-60"
            >
              {submitting
                ? 'Moving…'
                : date && chosen
                  ? `Move to ${shortDate}, ${departureTimes(chosen, date).start}`
                  : 'Pick a date and time'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  addMonths,
  calendarGrid,
  isoDate,
  monthName,
  startOfDay,
} from '@/lib/date';
import {
  getMonthBlackouts,
  FunctionError,
} from '@/lib/functions-client';
import { clsx } from '@/lib/clsx';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

interface Props {
  /** Tours can be booked up to N days ahead. Default 365. */
  maxAdvanceDays?: number;
}

export function BookingCalendar({ maxAdvanceDays = 365 }: Props) {
  const router = useRouter();
  const today = useMemo(() => startOfDay(new Date()), []);
  const maxDate = useMemo(() => {
    const d = new Date(today);
    d.setDate(d.getDate() + maxAdvanceDays);
    return d;
  }, [today, maxAdvanceDays]);

  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [blackouts, setBlackouts] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Refetch blackouts whenever the visible month changes.
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadError(null);

    getMonthBlackouts(viewYear, viewMonth + 1, { signal: controller.signal })
      .then(({ blackouts: list }) => setBlackouts(new Set(list)))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        if (err instanceof FunctionError && err.status === 404) {
          setBlackouts(new Set());
          return;
        }
        // For local dev without the functions URL configured, fall back to
        // an empty set so the UI still works against fake data.
        setBlackouts(new Set());
        setLoadError(
          err instanceof Error
            ? err.message
            : 'Could not load calendar availability.',
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [viewYear, viewMonth]);

  const grid = useMemo(
    () => calendarGrid(viewYear, viewMonth),
    [viewYear, viewMonth],
  );

  function previousMonth() {
    const prev = addMonths(new Date(viewYear, viewMonth, 1), -1);
    if (prev.getFullYear() < today.getFullYear() ||
        (prev.getFullYear() === today.getFullYear() && prev.getMonth() < today.getMonth())) {
      return; // can't go before this month
    }
    setViewYear(prev.getFullYear());
    setViewMonth(prev.getMonth());
  }

  function nextMonth() {
    const next = addMonths(new Date(viewYear, viewMonth, 1), 1);
    if (next > maxDate) return;
    setViewYear(next.getFullYear());
    setViewMonth(next.getMonth());
  }

  function selectDate(d: Date) {
    router.push(`/book/${isoDate(d)}`);
  }

  const isAtMin =
    viewYear === today.getFullYear() && viewMonth === today.getMonth();

  return (
    <div className="bg-white rounded-2xl border border-[var(--color-ink)]/8 shadow-[var(--shadow-card)] overflow-hidden">
      <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-[var(--color-ink)]/8">
        <button
          type="button"
          onClick={previousMonth}
          disabled={isAtMin}
          aria-label="Previous month"
          className="inline-flex items-center justify-center w-10 h-10 rounded-full text-[var(--color-brand-blue)] hover:bg-[var(--color-brand-blue)]/10 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <h2 className="font-display text-xl sm:text-2xl" aria-live="polite">
          {monthName(viewMonth)} {viewYear}
        </h2>
        <button
          type="button"
          onClick={nextMonth}
          aria-label="Next month"
          className="inline-flex items-center justify-center w-10 h-10 rounded-full text-[var(--color-brand-blue)] hover:bg-[var(--color-brand-blue)]/10"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      {loadError && (
        <div className="px-4 sm:px-6 py-2 text-xs text-[var(--color-coral-dark)] bg-[var(--color-coral)]/8 border-b border-[var(--color-coral)]/15">
          Couldn&rsquo;t load real-time availability — showing dates anyway.
        </div>
      )}

      <div className="px-2 sm:px-4 py-4">
        <div
          className="grid grid-cols-7 text-xs uppercase tracking-widest text-[var(--color-ink-soft)] mb-2"
          aria-hidden
        >
          {WEEKDAYS.map((d) => (
            <span key={d} className="px-2 py-1 text-center">
              {d}
            </span>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-1" role="grid" aria-busy={loading}>
          {grid.map((d) => {
            const inMonth = d.getMonth() === viewMonth;
            const iso = isoDate(d);
            const isPast = d < today;
            const tooFar = d > maxDate;
            const isBlackedOut = blackouts.has(iso);
            const disabled = isPast || tooFar || isBlackedOut || !inMonth;
            const isToday =
              d.getFullYear() === today.getFullYear() &&
              d.getMonth() === today.getMonth() &&
              d.getDate() === today.getDate();

            return (
              <button
                key={iso}
                type="button"
                disabled={disabled}
                onClick={() => selectDate(d)}
                role="gridcell"
                aria-label={d.toLocaleDateString('en-US', {
                  weekday: 'long',
                  month: 'long',
                  day: 'numeric',
                  year: 'numeric',
                })}
                className={clsx(
                  'relative aspect-square flex items-center justify-center rounded-2xl text-base sm:text-lg transition-colors',
                  !inMonth && 'opacity-30',
                  isPast && 'opacity-30',
                  tooFar && 'opacity-30 cursor-not-allowed',
                  isBlackedOut && 'line-through text-[var(--color-ink-soft)] cursor-not-allowed',
                  !disabled && 'hover:bg-[var(--color-brand-blue)]/10 cursor-pointer',
                  isToday && !disabled && 'ring-1 ring-[var(--color-brand-blue)]/40',
                )}
              >
                <span className={clsx('relative z-10', !inMonth && 'text-[var(--color-ink-soft)]')}>
                  {d.getDate()}
                </span>
                {isBlackedOut && (
                  <span className="sr-only">Unavailable</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="px-4 sm:px-6 py-3 border-t border-[var(--color-ink)]/8 text-xs text-[var(--color-ink-soft)] flex items-center gap-4 flex-wrap">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full ring-1 ring-[var(--color-brand-blue)]/40" />
          Today
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full bg-[var(--color-ink)]/15" />
          Closed (weather or maintenance)
        </span>
      </div>
    </div>
  );
}

'use client';

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { dayLevel, type DayAvailability, type DayLevel, type MarinaClock, type TourKind } from '@/lib/availability';
import type { MarketingTour } from '@/lib/tours';
import { monthName } from '@/lib/date';
import { ChevronLeft, ChevronRight } from '@/components/ui/icons';
import { useTourCatalog } from '@/components/TourCatalog';
import { clsx } from '@/lib/clsx';

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

interface Props {
  year: number;
  month0: number;
  onMonthChange: (year: number, month0: number) => void;
  selected: string | null;
  onSelect: (iso: string) => void;
  getDay: (iso: string) => DayAvailability | undefined;
  guests: number;
  kind: TourKind;
  /** Marina "today", YYYY-MM-DD. */
  today: string;
  /** Marina clock, so today's cell closes once its last departure has. */
  now: MarinaClock;
  /** Last bookable date, YYYY-MM-DD. */
  maxDate: string;
  loading: boolean;
  /**
   * The tours a day can be booked for. Defaults to the live catalog; the
   * move dialog narrows it to the departures a closed booking can move to.
   */
  catalog?: readonly MarketingTour[];
}

function iso(y: number, m0: number, d: number) {
  return `${y}-${String(m0 + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function shiftIso(date: string, days: number) {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d! + days));
  return dt.toISOString().slice(0, 10);
}

const levelCopy: Record<DayLevel, string> = {
  open: 'Open',
  limited: 'Filling up',
  full: 'Full',
  closed: 'Not running',
  unknown: '',
};

export function AvailabilityCalendar({
  year,
  month0,
  onMonthChange,
  selected,
  onSelect,
  getDay,
  guests,
  kind,
  today,
  now,
  maxDate,
  loading,
  catalog,
}: Props) {
  const gridRef = useRef<HTMLDivElement>(null);
  const live = useTourCatalog().tours;
  const tours = catalog ?? live;
  const daysInMonth = new Date(year, month0 + 1, 0).getDate();
  const leading = new Date(year, month0, 1).getDay();
  const monthPrefix = iso(year, month0, 1).slice(0, 7);

  const atMin = monthPrefix <= today.slice(0, 7);
  const atMax = monthPrefix >= maxDate.slice(0, 7);

  // Roving focus: one date in the grid is tabbable; arrows move it.
  const [focusDate, setFocusDate] = useState<string | null>(null);
  const pendingFocus = useRef(false);

  const cells = useMemo(() => {
    return Array.from({ length: daysInMonth }, (_, i) => {
      const date = iso(year, month0, i + 1);
      const past = date < today;
      const beyond = date > maxDate;
      const level: DayLevel = past || beyond ? 'closed' : dayLevel(getDay(date), guests, kind, now, tours);
      return { date, day: i + 1, past, beyond, level };
    });
  }, [daysInMonth, year, month0, today, maxDate, getDay, guests, kind, now, tours]);

  const weeks = useMemo(() => {
    const padded: Array<(typeof cells)[number] | null> = [
      ...Array.from({ length: leading }, () => null),
      ...cells,
    ];
    while (padded.length % 7) padded.push(null);
    return Array.from({ length: padded.length / 7 }, (_, i) => padded.slice(i * 7, i * 7 + 7));
  }, [cells, leading]);

  const tabbable =
    (focusDate && focusDate.startsWith(monthPrefix) && focusDate) ||
    (selected && selected.startsWith(monthPrefix) && selected) ||
    cells.find((c) => !c.past && !c.beyond)?.date ||
    cells[0]!.date;

  useEffect(() => {
    if (!pendingFocus.current || !focusDate) return;
    const el = gridRef.current?.querySelector<HTMLButtonElement>(`[data-date="${focusDate}"]`);
    if (el) {
      el.focus();
      pendingFocus.current = false;
    }
  }, [focusDate, year, month0]);

  function moveFocus(to: string) {
    if (to < today || to > maxDate) return;
    setFocusDate(to);
    pendingFocus.current = true;
    const [y, m] = to.split('-').map(Number);
    if (y !== year || m! - 1 !== month0) onMonthChange(y!, m! - 1);
  }

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, date: string) {
    const deltas: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
    };
    if (e.key in deltas) {
      e.preventDefault();
      moveFocus(shiftIso(date, deltas[e.key]!));
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      const dow = new Date(`${date}T12:00:00`).getDay();
      moveFocus(shiftIso(date, e.key === 'Home' ? -dow : 6 - dow));
    }
  }

  function step(delta: number) {
    const d = new Date(year, month0 + delta, 1);
    onMonthChange(d.getFullYear(), d.getMonth());
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <h3 className="text-display text-[1.35rem]" aria-live="polite">
          {monthName(month0)} <span className="text-[var(--color-ink-soft)]">{year}</span>
        </h3>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => step(-1)}
            disabled={atMin}
            aria-label="Previous month"
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--color-sand)] bg-white text-[var(--color-ink)] transition-colors hover:border-[var(--color-ink)]/40 disabled:opacity-35 disabled:hover:border-[var(--color-sand)]"
          >
            <ChevronLeft size={18} />
          </button>
          <button
            type="button"
            onClick={() => step(1)}
            disabled={atMax}
            aria-label="Next month"
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--color-sand)] bg-white text-[var(--color-ink)] transition-colors hover:border-[var(--color-ink)]/40 disabled:opacity-35 disabled:hover:border-[var(--color-sand)]"
          >
            <ChevronRight size={18} />
          </button>
        </div>
      </div>

      {/* Visual only: each day cell's label already names its weekday, and a
          row outside the grid isn't valid ARIA. */}
      <div
        aria-hidden="true"
        className="mt-5 grid grid-cols-7 text-center text-[0.7rem] font-semibold uppercase tracking-[0.08em] text-[var(--color-ink-soft)]"
      >
        {WEEKDAYS.map((d, i) => (
          <span key={i} className="pb-2">
            {d}
          </span>
        ))}
      </div>

      <div
        ref={gridRef}
        role="grid"
        aria-label={`${monthName(month0)} ${year}`}
        aria-busy={loading}
        className={clsx('space-y-1 transition-opacity', loading && 'opacity-60')}
      >
        {weeks.map((week, w) => (
          <div key={w} role="row" className="grid grid-cols-7 gap-1">
            {week.map((cell, i) => {
              if (!cell) return <span key={`pad-${w}-${i}`} role="gridcell" aria-hidden />;
              const { date, day, past, beyond, level } = cell;
          const isSelected = date === selected;
          const isToday = date === today;
          const disabled = past || beyond || level === 'closed' || level === 'full';
          const dow = new Date(`${date}T12:00:00`).getDay();
          const label = [
            `${WEEKDAYS_LONG[dow]}, ${monthName(month0)} ${day}`,
            isToday ? 'today' : '',
            past ? 'past' : levelCopy[level],
            level === 'full' ? `for ${guests} ${guests === 1 ? 'guest' : 'guests'}` : '',
          ]
            .filter(Boolean)
            .join(', ');
          return (
            <button
              key={date}
              type="button"
              role="gridcell"
              data-date={date}
              tabIndex={date === tabbable ? 0 : -1}
              aria-selected={isSelected}
              aria-disabled={disabled || undefined}
              aria-label={label}
              onClick={() => !disabled && onSelect(date)}
              onKeyDown={(e) => {
                if ((e.key === 'Enter' || e.key === ' ') && !disabled) {
                  e.preventDefault();
                  onSelect(date);
                  return;
                }
                onKeyDown(e, date);
              }}
              onFocus={() => setFocusDate(date)}
              className={clsx(
                'relative flex h-12 flex-col items-center justify-center rounded-lg text-[0.95rem] tabular-nums transition-colors sm:h-14',
                isSelected
                  ? 'bg-[var(--color-ink)] font-semibold text-white'
                  : disabled
                    ? 'cursor-not-allowed text-[var(--color-ink-soft)]/45'
                    : 'font-medium text-[var(--color-ink)] hover:bg-[var(--color-mist)]',
                level === 'full' && !isSelected && 'line-through decoration-[var(--color-ink-soft)]/50',
                isToday && !isSelected && 'ring-1 ring-inset ring-[var(--color-ink)]/25',
              )}
            >
              <span>{day}</span>
              {!past && !beyond && (level === 'open' || level === 'limited') && (
                <span
                  aria-hidden
                  className={clsx(
                    'absolute bottom-1.5 h-1.5 w-1.5 rounded-full sm:bottom-2',
                    level === 'open' && (isSelected ? 'bg-[var(--color-spring-bright)]' : 'bg-[var(--color-spring)]'),
                    level === 'limited' && 'bg-[var(--color-buoy)]',
                  )}
                />
              )}
            </button>
              );
            })}
          </div>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-[var(--color-ink-soft)]">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-spring)]" /> Open
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-buoy)]" /> Filling up
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="line-through">14</span> Full for your group
        </span>
      </div>
    </div>
  );
}

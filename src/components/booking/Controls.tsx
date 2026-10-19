'use client';

import type { TourKind } from '@/lib/availability';
import { BOAT_CAPACITY } from '@/lib/availability';
import { Minus, Plus } from '@/components/ui/icons';
import { formatPriceRange, priceRangeOn, upcomingPriceRange } from '@/lib/pricing';
import { useTourCatalog } from '@/components/TourCatalog';
import { clsx } from '@/lib/clsx';

export function GuestStepper({
  value,
  onChange,
  max = BOAT_CAPACITY,
  tone = 'light',
  id = 'guest-count',
}: {
  value: number;
  onChange: (n: number) => void;
  max?: number;
  tone?: 'light' | 'dark';
  id?: string;
}) {
  const dark = tone === 'dark';
  const btn = clsx(
    'inline-flex h-10 w-10 items-center justify-center rounded-lg border transition-colors disabled:opacity-30',
    dark
      ? 'border-white/25 text-white hover:bg-white/10 disabled:hover:bg-transparent'
      : 'border-[var(--color-sand)] bg-white text-[var(--color-ink)] hover:border-[var(--color-ink)]/40 disabled:hover:border-[var(--color-sand)]',
  );
  return (
    <div className="inline-flex items-center gap-2" role="group" aria-labelledby={`${id}-label`}>
      <button
        type="button"
        className={btn}
        onClick={() => onChange(Math.max(1, value - 1))}
        disabled={value <= 1}
        aria-label="One fewer guest"
      >
        <Minus size={18} />
      </button>
      <output
        aria-live="polite"
        className={clsx('w-16 text-center tabular-nums', dark ? 'text-white' : 'text-[var(--color-ink)]')}
      >
        <span className="text-display text-[1.6rem] leading-none">{value}</span>
        <span className={clsx('block text-[0.7rem] font-medium', dark ? 'text-white/60' : 'text-[var(--color-ink-soft)]')}>
          {value === 1 ? 'guest' : 'guests'}
        </span>
      </output>
      <button
        type="button"
        className={btn}
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={value >= max}
        aria-label="One more guest"
      >
        <Plus size={18} />
      </button>
    </div>
  );
}

/**
 * The tour-type buttons, each with its price: on the chosen date, or
 * "from" the lowest upcoming price before a date is picked.
 */
export function KindFilter({
  value,
  onChange,
  date,
  today,
}: {
  value: TourKind;
  onChange: (k: TourKind) => void;
  date: string | null;
  today: string;
}) {
  const { tours, seasons } = useTourCatalog();
  const running = tours.filter((t) => t.active);
  const price = (list: typeof running) =>
    formatPriceRange(date ? priceRangeOn(list, date, seasons) : upcomingPriceRange(list, today, seasons));
  const shared = running.filter((t) => t.type === 'shared');
  // The 2-hour private boats; the sunset cruise lists its own price.
  const priv = running.filter((t) => t.type === 'private' && t.timeSlot !== 'whole-day' && t.timeSlot !== 'sunset');
  const wholeDay = running.filter((t) => t.timeSlot === 'whole-day');
  const hours = wholeDay[0]
    ? `, ${wholeDay[0].startTimeDisplay.replace(':00', '')}–${wholeDay[0].endTimeDisplay.replace(':00', '')}`
    : '';
  const KINDS: Array<{ value: TourKind; label: string; sub: string }> = [
    { value: 'any', label: 'Any tour', sub: 'Show everything' },
    { value: 'shared', label: 'Shared', sub: shared.length ? `${price(shared)} a seat` : 'Not running' },
    { value: 'private', label: 'Private', sub: priv.length ? `${price(priv)} the boat` : 'Not running' },
    { value: 'whole-day', label: 'Whole day', sub: wholeDay.length ? `${price(wholeDay)}${hours}` : 'Not running' },
  ];
  return (
    <div role="radiogroup" aria-label="Tour type" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {KINDS.map((k) => {
        const active = k.value === value;
        return (
          <button
            key={k.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(k.value)}
            className={clsx(
              'rounded-lg border px-3 py-2.5 text-left transition-colors',
              active
                ? 'border-[var(--color-ink)] bg-[var(--color-ink)] text-white'
                : 'border-[var(--color-sand)] bg-white text-[var(--color-ink)] hover:border-[var(--color-ink)]/40',
            )}
          >
            <span className="block text-sm font-semibold">{k.label}</span>
            <span className={clsx('block text-xs', active ? 'text-white/65' : 'text-[var(--color-ink-soft)]')}>
              {k.sub}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function StepIndicator({ step }: { step: 1 | 2 | 3 | 4 }) {
  const steps = ['Departure', 'Your group', 'Payment'];
  return (
    <ol className="flex items-center gap-2 text-sm" aria-label="Booking progress">
      {steps.map((label, i) => {
        const n = i + 1;
        const done = n < step;
        const current = n === step;
        return (
          <li key={label} className="flex items-center gap-2">
            <span
              aria-current={current ? 'step' : undefined}
              className={clsx(
                'inline-flex items-center gap-2 rounded-full py-1 pl-1 pr-3 font-medium',
                current && 'bg-[var(--color-ink)] text-white',
                done && 'text-[var(--color-ink)]',
                !current && !done && 'text-[var(--color-ink-soft)]',
              )}
            >
              <span
                className={clsx(
                  'inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold tabular-nums',
                  current && 'bg-[var(--color-buoy)] text-[var(--color-ink)]',
                  done && 'bg-[var(--color-spring)] text-white',
                  !current && !done && 'border border-[var(--color-ink)]/20',
                )}
              >
                {done ? '✓' : n}
              </span>
              <span className={clsx(!current && 'hidden sm:inline')}>{label}</span>
            </span>
            {n < steps.length && <span aria-hidden className="h-px w-4 bg-[var(--color-ink)]/15 sm:w-8" />}
          </li>
        );
      })}
    </ol>
  );
}

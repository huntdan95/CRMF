'use client';

import {
  matchesKind,
  statusLabel,
  tourStatus,
  type DayAvailability,
  type MarinaClock,
  type TourKind,
} from '@/lib/availability';
import { departureTimes, formatPrice, slotOrder, type MarketingTour, type TourTimeSlot } from '@/lib/tours';
import { slotRunsOn } from '@/lib/schedule';
import { seasonFor, totalOn, unitPriceOn, type SeasonRates } from '@/lib/pricing';
import { useTourCatalog } from '@/components/TourCatalog';
import { formatFriendlyDate } from '@/lib/date';
import { siteConfig } from '@/lib/site-config';
import { Check, Phone } from '@/components/ui/icons';
import { clsx } from '@/lib/clsx';

interface Props {
  date: string | null;
  day: DayAvailability | undefined;
  /** True while this date's seat counts are still loading. */
  pending: boolean;
  /** Marina clock; departures inside the online cutoff are closed. */
  now: MarinaClock;
  guests: number;
  kind: TourKind;
  selectedSlug: string | null;
  onSelect: (slug: string) => void;
}

const slotName: Record<TourTimeSlot, string> = {
  morning: 'Morning',
  'mid-morning': 'Mid-morning',
  'early-afternoon': 'Early afternoon',
  'late-afternoon': 'Late afternoon',
  'whole-day': 'Whole-day charter',
  sunset: 'Sunset cruise',
};

/** What the option is: shared seats, the boat for a trip, the whole day, or the cruise. */
function optionLabel(tour: MarketingTour): string {
  if (tour.timeSlot === 'whole-day') return 'Private, all day';
  if (tour.timeSlot === 'sunset') return 'Private cruise';
  return tour.type === 'shared' ? 'Shared boat' : 'Private boat';
}

/** What this group pays for this tour on this date, seasonal rates included. */
export function priceFor(tour: MarketingTour, guests: number, date: string, seasons: readonly SeasonRates[]) {
  return totalOn(tour, guests, date, seasons);
}

export function DeparturePicker({ date, day, pending, now, guests, kind, selectedSlug, onSelect }: Props) {
  const { tours, seasons } = useTourCatalog();
  // Before a date is picked, today's prices.
  const priceDate = date ?? now.date;
  const visibleRows = [...slotOrder, 'sunset' as const, 'whole-day' as const]
    // The sunset cruise only shows in its season (April 1 – November 14).
    .filter((slot) => slotRunsOn(slot, priceDate))
    .map((slot) => ({
      slot,
      options: tours.filter((t) => t.active && t.timeSlot === slot && matchesKind(t, kind)),
    }))
    .filter((r) => r.options.length > 0);

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="text-display text-[1.35rem]">
          {date ? formatFriendlyDate(date).replace(/, \d{4}$/, '') : 'Departures'}
        </h3>
        <p className="text-sm text-[var(--color-ink-soft)]">
          {date
            ? `${guests} ${guests === 1 ? 'guest' : 'guests'} · from ${siteConfig.marina.name}`
            : 'Pick a date to see live seat counts'}
        </p>
      </div>

      {visibleRows.length === 0 && (
        <p className="mt-5 rounded-xl border border-[var(--color-sand)] bg-white px-4 py-3.5 text-[0.9375rem]">
          {kind === 'any'
            ? 'No tours are taking online bookings right now.'
            : 'That type of tour isn’t running right now. Pick another type above.'}
        </p>
      )}

      <div role="radiogroup" aria-label="Departure" className="mt-5 space-y-3">
        {visibleRows.map(({ slot, options }) => {
          const first = options[0]!;
          const times = departureTimes(first, date);
          // No date yet: the sunset cruise has no clock time, just "90 min
          // before sunset", which is too wide to sit on one line on a phone.
          const sunsetWords = slot === 'sunset' && !date;
          return (
            <div
              key={slot}
              className="rounded-xl border border-[var(--color-sand)] bg-white p-3 sm:p-4"
            >
              <div className="flex items-baseline justify-between gap-3 px-1 pb-3">
                <p className={clsx('flex items-baseline gap-x-3 gap-y-0.5', sunsetWords && 'flex-wrap')}>
                  <span className={clsx('text-display text-[1.25rem] tabular-nums', !sunsetWords && 'whitespace-nowrap')}>
                    {times.start}
                  </span>
                  <span className="text-sm text-[var(--color-ink-soft)]">
                    {slotName[slot]} · back {times.end}
                  </span>
                </p>
                <span className="hidden text-xs text-[var(--color-ink-soft)] sm:inline">
                  {first.durationHours} hrs
                </span>
              </div>
              <div className={clsx('grid gap-2', options.length > 1 && 'sm:grid-cols-2')}>
                {options.map((tour) => {
                  const status = date ? tourStatus(tour, day, guests, { date, now }) : { bookable: true as const, seatsLeft: null };
                  const selected = tour.slug === selectedSlug;
                  const disabled = !date || !status.bookable;
                  const total = priceFor(tour, guests, priceDate, seasons);
                  const unit = unitPriceOn(tour, priceDate, seasons);
                  const season = date ? seasonFor(tour, date, seasons) : null;
                  const sharedHere = tours.find((t) => t.active && t.type === 'shared' && t.timeSlot === tour.timeSlot);
                  const cheaperThanSeats =
                    tour.type === 'private' &&
                    tour.timeSlot !== 'whole-day' &&
                    !!sharedHere &&
                    unitPriceOn(sharedHere, priceDate, seasons) * guests >= total;
                  return (
                    <label
                      key={tour.slug}
                      className={clsx(
                        'group relative flex cursor-pointer items-start gap-3 rounded-lg border px-3.5 py-3 transition-colors',
                        selected
                          ? 'border-[var(--color-ink)] bg-[var(--color-ink)] text-white'
                          : disabled
                            ? 'cursor-not-allowed border-transparent bg-[var(--color-paper)] text-[var(--color-ink-soft)]'
                            : 'border-[var(--color-sand)] hover:border-[var(--color-ink)]/50',
                      )}
                    >
                      <input
                        type="radio"
                        name="departure"
                        value={tour.slug}
                        checked={selected}
                        disabled={disabled}
                        onChange={() => onSelect(tour.slug)}
                        aria-label={[
                          times.start,
                          optionLabel(tour).toLowerCase(),
                          formatPrice(total),
                          date ? (pending ? 'checking seats' : statusLabel(status, tour)) : 'pick a date first',
                        ].join(', ')}
                        className="peer sr-only"
                      />
                      <span
                        aria-hidden
                        className={clsx(
                          'mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--color-spring)]',
                          selected
                            ? 'border-[var(--color-buoy)] bg-[var(--color-buoy)] text-[var(--color-ink)]'
                            : disabled
                              ? 'border-[var(--color-ink)]/15'
                              : 'border-[var(--color-ink)]/30 bg-white',
                        )}
                      >
                        {selected && <Check size={13} strokeWidth={3} />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-2">
                          <span className="font-semibold">{optionLabel(tour)}</span>
                          <span className="font-semibold tabular-nums">{formatPrice(total)}</span>
                        </span>
                        <span className="mt-0.5 flex items-baseline justify-between gap-2 text-[0.8125rem]">
                          <span
                            className={clsx(
                              selected
                                ? 'text-white/75'
                                : status.bookable && status.seatsLeft != null && status.seatsLeft <= 2
                                  ? 'font-medium text-[var(--color-buoy-deep)]'
                                  : status.bookable
                                    ? 'text-[var(--color-spring)]'
                                    : 'text-[var(--color-ink-soft)]',
                              pending && date && 'animate-pulse',
                            )}
                          >
                            {!date
                              ? tour.type === 'shared'
                                ? 'Up to 6 seats'
                                : 'Whole boat, up to 6'
                              : pending
                                ? 'Checking seats…'
                                : statusLabel(status, tour)}
                          </span>
                          <span className={selected ? 'text-white/65' : 'text-[var(--color-ink-soft)]'}>
                            {tour.type === 'shared'
                              ? `${formatPrice(unit)} × ${guests}`
                              : 'up to 6 guests'}
                          </span>
                        </span>
                        {season && (
                          <span className={clsx('mt-1 block text-[0.75rem]', selected ? 'text-white/65' : 'text-[var(--color-ink-soft)]')}>
                            {season.name} rate
                          </span>
                        )}
                        {cheaperThanSeats && status.bookable && date && (
                          <span
                            className={clsx(
                              'mt-1.5 inline-block rounded px-1.5 py-0.5 text-[0.7rem] font-semibold',
                              selected ? 'bg-white/15 text-white' : 'bg-[var(--color-mist)] text-[var(--color-spring)]',
                            )}
                          >
                            Costs less than {guests} shared seats
                          </span>
                        )}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {date && (
        <p className="mt-4 flex items-start gap-2 text-sm text-[var(--color-ink-soft)]">
          <Phone size={16} className="mt-0.5 shrink-0" />
          <span>
            Need a departure that&rsquo;s full, or more than six people? Call{' '}
            <a href={siteConfig.contact.phoneHref} className="font-medium text-[var(--color-ink)] underline underline-offset-2">
              {siteConfig.contact.phone}
            </a>
            . Same-day seats are booked by phone.
          </span>
        </p>
      )}
    </div>
  );
}

import Link from 'next/link';
import type { MarketingTour, TourTimeSlot } from '@/lib/tours';
import { formatPrice, slotLabels } from '@/lib/tours';
import { SiteImage } from './SiteImage';
import { clsx } from '@/lib/clsx';
import type { SiteImageSlot } from '@/lib/firebase/types';

interface Props {
  tour: MarketingTour;
  /** Optional override — defaults to a sensible slot per tour type. */
  imageSlot?: SiteImageSlot;
}

// One short, customer-facing slot label (no need to repeat the date).
const slotShort: Record<TourTimeSlot, string> = {
  morning: 'Morning',
  'mid-morning': 'Mid-morning',
  'early-afternoon': 'Afternoon',
  'late-afternoon': 'Late afternoon',
  'whole-day': 'All day',
};

/**
 * Editorial, photo-led tour card.
 *
 * Most of the card is the photo. A single subtle pill in the top corner
 * encodes the slot + start time. Below the photo, just the name and the
 * decision-critical pieces: price, duration, "Book →". Nothing else.
 * Anything more detailed belongs on the tour page.
 */
export function TourCard({ tour, imageSlot }: Props) {
  const isPrivate = tour.type === 'private';
  const slot = imageSlot ?? defaultImageSlot(tour);

  // Strip the verbose "2hr X Tour — Type" name down to something glanceable.
  // "2hr Morning Tour — Shared" → "Morning"
  // "2hr Morning Tour — Private" → "Morning · Private"
  // "Whole Day Tour — Private" → "Whole Day · Private"
  const headline =
    tour.timeSlot === 'whole-day'
      ? 'Whole Day'
      : slotShort[tour.timeSlot];

  const priceLine =
    tour.type === 'shared' && tour.pricePerPerson != null
      ? formatPrice(tour.pricePerPerson)
      : tour.flatPrice != null
        ? formatPrice(tour.flatPrice)
        : '—';
  const priceUnit =
    tour.type === 'shared' ? 'per person' : 'whole boat';

  return (
    <Link
      href={`/book/${tour.slug}`}
      aria-label={`Book ${tour.name}`}
      className="group block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-blue)] focus-visible:ring-offset-2 rounded-2xl"
    >
      <article className="relative overflow-hidden rounded-2xl bg-[var(--color-ink)]">
        {/* Photo fills the whole card */}
        <div className="aspect-[4/5] w-full">
          <SiteImage
            slot={slot}
            aspect="auto"
            rounded="none"
            className="absolute inset-0 transition-transform duration-700 ease-out group-hover:scale-105"
          />
        </div>

        {/* Vignette so type stays legible regardless of photo */}
        <div
          aria-hidden
          className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/15 to-black/30"
        />

        {/* Top: slot + time pill, plus private indicator */}
        <div className="absolute top-4 left-4 right-4 flex items-start justify-between gap-2 z-10">
          <span className="inline-flex items-center px-3 py-1 rounded-full bg-white/95 backdrop-blur text-[var(--color-ink)] text-[11px] font-semibold uppercase tracking-[0.14em]">
            {headline} · {tour.startTimeDisplay}
          </span>
          {isPrivate && (
            <span className="inline-flex items-center px-3 py-1 rounded-full bg-[var(--color-coral)] text-white text-[11px] font-semibold uppercase tracking-[0.14em]">
              Private
            </span>
          )}
        </div>

        {/* Bottom: name + price */}
        <div className="absolute inset-x-0 bottom-0 p-5 sm:p-6 text-white z-10">
          <h3 className="font-display text-2xl sm:text-3xl leading-tight">
            {tour.timeSlot === 'whole-day'
              ? 'A whole day on the river.'
              : `${slotShort[tour.timeSlot]}, ${tour.startTimeDisplay}`}
          </h3>

          <div className="mt-4 flex items-end justify-between gap-3">
            <div>
              <p className="font-display text-3xl sm:text-4xl leading-none">
                {priceLine}
              </p>
              <p className="text-xs uppercase tracking-widest text-white/75 mt-1">
                {priceUnit} · {tour.durationHours}{tour.durationHours === 1 ? 'hr' : 'hrs'}
              </p>
            </div>
            <span
              className={clsx(
                'inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-[var(--color-coral)] text-white text-sm font-semibold shadow-lg',
                'transition-transform duration-200 group-hover:translate-x-1',
              )}
            >
              Book
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path
                  d="M5 12h14M13 6l6 6-6 6"
                  stroke="currentColor"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
          </div>
        </div>
      </article>
    </Link>
  );
}

function defaultImageSlot(tour: MarketingTour): SiteImageSlot {
  if (tour.timeSlot === 'whole-day') return 'group';
  if (tour.type === 'private') return 'greeting';
  return 'dappled';
}

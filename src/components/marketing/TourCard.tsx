import Link from 'next/link';
import type { MarketingTour, TourTimeSlot } from '@/lib/tours';
import { formatPrice, slotLabels } from '@/lib/tours';
import { SiteImage } from './SiteImage';
import { clsx } from '@/lib/clsx';
import { tourSlotForSlug } from '@/lib/site-images';
import type { SiteImageSlot } from '@/lib/firebase/types';

interface Props {
  tour: MarketingTour;
  /**
   * Force-override the photo slot for this card. Almost never needed — by
   * default each tour gets its own `tour-{slug}` slot, falling back to the
   * legacy `dappled` slot for pre-refactor uploads.
   */
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
  // Default to the tour's dedicated slot (e.g. tour-morning-shared). If no
  // upload exists there, SiteImage falls back to the legacy `dappled`
  // slot so existing single-photo setups still display something.
  const slot = imageSlot ?? tourSlotForSlug(tour.slug) ?? 'dappled';

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
            fallbackSlot="dappled"
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

        {/* Top: slot + time pill, plus private indicator. Pill is fully
            opaque dark-ink with white text so it reads on light photo
            tops (sunlit shallows, etc.) where the previous white/95
            translucent pill blended into the photo. */}
        <div className="absolute top-4 left-4 right-4 flex items-start justify-between gap-2 z-10">
          <span className="inline-flex items-center px-3 py-1 rounded-full bg-[var(--color-ink)] text-white text-[11px] font-semibold uppercase tracking-[0.14em] shadow-md ring-1 ring-white/10">
            {headline} · {tour.startTimeDisplay}
          </span>
          {isPrivate && (
            <span className="inline-flex items-center px-3 py-1 rounded-full bg-[var(--color-coral)] text-white text-[11px] font-semibold uppercase tracking-[0.14em] shadow-md">
              Private
            </span>
          )}
        </div>

        {/* Bottom: just price + CTA. The slot + start time already appear
            in the top pill, so the redundant headline was dropped. The
            whole-day tour also gets a tighter line above the price since
            it's notably distinct from the 2hr tours. */}
        <div className="absolute inset-x-0 bottom-0 p-5 sm:p-6 text-white z-10">
          {tour.timeSlot === 'whole-day' && (
            <p className="font-display text-xl sm:text-2xl leading-tight mb-4 text-white">
              All day on the river.
            </p>
          )}
          <div className="flex items-end justify-between gap-3">
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


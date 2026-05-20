import Link from 'next/link';
import type { Tour } from '@/lib/tours';
import { formatTourPrice } from '@/lib/tours';
import { PlaceholderImage } from './PlaceholderImage';

interface Props {
  tour: Tour;
  /** Compact card variant for the homepage featured grid. */
  size?: 'default' | 'compact';
}

const slotLabel: Record<Tour['timeSlot'], string> = {
  early: 'Early',
  morning: 'Morning',
  midday: 'Midday',
  afternoon: 'Afternoon',
  'whole-day': 'All day',
};

export function TourCard({ tour, size = 'default' }: Props) {
  return (
    <article
      className="group flex flex-col rounded-2xl bg-white overflow-hidden border border-[var(--color-ink)]/8 shadow-[var(--shadow-card)] hover:shadow-[var(--shadow-soft)] hover:-translate-y-0.5 transition-all duration-200"
    >
      <Link href={`/tours/${tour.slug}`} className="block" aria-label={tour.name}>
        <PlaceholderImage
          label={`${tour.name} — boat & manatees in spring`}
          aspect={size === 'compact' ? 'video' : 'video'}
          rounded="none"
          tone={
            tour.type === 'private'
              ? 'bg-[var(--color-coral)]/15'
              : 'bg-[var(--color-brand-blue)]/15'
          }
        />
      </Link>
      <div className="p-5 flex flex-col gap-3 grow">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className={
              tour.type === 'private'
                ? 'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-[var(--color-coral)]/15 text-[var(--color-coral-dark)]'
                : 'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-[var(--color-brand-blue)]/15 text-[var(--color-brand-blue-dark)]'
            }
          >
            {tour.type === 'private' ? 'Private boat' : 'Shared (up to 6)'}
          </span>
          <span className="text-xs text-[var(--color-ink-soft)]">
            {slotLabel[tour.timeSlot]} · {tour.startTimeDisplay} · {tour.durationHours}h
          </span>
        </div>
        <h3 className="font-display text-xl leading-snug">
          <Link
            href={`/tours/${tour.slug}`}
            className="hover:text-[var(--color-brand-blue)]"
          >
            {tour.name}
          </Link>
        </h3>
        <p className="text-sm text-[var(--color-ink-soft)] grow">
          {tour.shortDescription}
        </p>
        <div className="flex items-center justify-between pt-2">
          <p className="font-display text-lg text-[var(--color-brand-blue)]">
            {formatTourPrice(tour)}
          </p>
          <Link
            href={`/book/${tour.slug}`}
            className="text-sm font-medium text-[var(--color-coral-dark)] hover:text-[var(--color-coral)]"
          >
            Book →
          </Link>
        </div>
      </div>
    </article>
  );
}

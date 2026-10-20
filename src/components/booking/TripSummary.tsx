'use client';

import { useState, type ReactNode } from 'react';
import type { MarketingTour } from '@/lib/tours';
import { departureTimes, formatPrice } from '@/lib/tours';
import { formatFriendlyDate } from '@/lib/date';
import { siteConfig } from '@/lib/site-config';
import { Camera, ChevronDown, Clock, Cup, Mask, MapPin, Shield, Swim, Users } from '@/components/ui/icons';
import { checkoutTotalFor } from './DeparturePicker';
import { SALES_TAX_RATE, seasonFor, unitPriceOn } from '@/lib/pricing';
import { useTourCatalog } from '@/components/TourCatalog';
import { boatLabel } from '@/lib/experience';
import { clsx } from '@/lib/clsx';

interface Props {
  tour: MarketingTour | null;
  date: string | null;
  guests: number;
  /** The step's main action (Continue / Pay). */
  action?: ReactNode;
  /** Optional "edit" affordance shown on the details step. */
  onEdit?: () => void;
}

export const included = [
  { icon: Swim, label: 'Travis in the water with your group' },
  { icon: Mask, label: 'Wetsuit, mask and snorkel' },
  { icon: Camera, label: 'GoPro photos of your swim, free' },
  { icon: Cup, label: 'Water and hot chocolate on board' },
];

/** The sunset cruise has no swim and no gear. */
const cruiseIncluded = [
  { icon: Users, label: 'The whole boat for your group' },
  { icon: Clock, label: 'Two hours, out before sunset and back after' },
  { icon: Cup, label: 'BYOB: bring your own drinks and food' },
];


export function TripSummary({ tour, date, guests, action, onEdit }: Props) {
  const { seasons } = useTourCatalog();
  const price = tour && date ? checkoutTotalFor(tour, guests, date, seasons) : null;
  const total = price?.total ?? null;
  const season = tour && date ? seasonFor(tour, date, seasons) : null;
  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--color-sand)] bg-white">
      <div className="bg-[var(--color-spring-deep)] px-6 py-5 text-white">
        <div className="flex items-center justify-between gap-3">
          <p className="text-label text-[var(--color-spring-bright)]">Your trip</p>
          {onEdit && (
            <button
              type="button"
              onClick={onEdit}
              className="text-sm font-medium text-white/80 underline underline-offset-2 hover:text-white"
            >
              Change
            </button>
          )}
        </div>
        {tour && date ? (
          <>
            <p className="mt-2 text-display text-[1.6rem]">
              {formatFriendlyDate(date).replace(/, \d{4}$/, '')}
            </p>
            <p className="mt-1 text-white/75 tabular-nums">
              {departureTimes(tour, date).start} – {departureTimes(tour, date).end} · {boatLabel(tour)}
            </p>
          </>
        ) : (
          <p className="mt-2 text-white/75">
            {date
              ? `${formatFriendlyDate(date).replace(/, \d{4}$/, '')}. Now pick a departure.`
              : 'Pick a date and a departure time.'}
          </p>
        )}
      </div>

      <div className="px-6 py-5">
        <dl className="space-y-2.5 text-[0.9375rem]">
          <div className="flex justify-between gap-4">
            <dt className="text-[var(--color-ink-soft)]">Guests</dt>
            <dd className="font-medium tabular-nums">{guests}</dd>
          </div>
          {tour && date && (
            <div className="flex justify-between gap-4">
              <dt className="text-[var(--color-ink-soft)]">
                {tour.type === 'shared'
                  ? `${formatPrice(unitPriceOn(tour, date, seasons))} × ${guests} ${guests === 1 ? 'seat' : 'seats'}`
                  : `Whole boat, up to ${tour.maxGuests}`}
                {season && <span className="block text-xs">{season.name} rate</span>}
              </dt>
              <dd className="font-medium tabular-nums">{formatPrice(price?.subtotal ?? 0)}</dd>
            </div>
          )}
          {price && (
            <div className="flex justify-between gap-4">
              <dt className="text-[var(--color-ink-soft)]">Florida sales tax ({SALES_TAX_RATE * 100}%)</dt>
              <dd className="font-medium tabular-nums">{formatPrice(price.tax)}</dd>
            </div>
          )}
        </dl>
        <div className="mt-4 flex items-baseline justify-between border-t border-[var(--color-sand)] pt-4">
          <p className="font-semibold">Total</p>
          <p className="text-display text-[1.75rem] tabular-nums">
            {total != null ? formatPrice(total) : '—'}
          </p>
        </div>
        <p className="mt-1 text-right text-xs text-[var(--color-ink-soft)]">
          Includes Florida sales tax. No booking fees.
        </p>

        {action && <div className="mt-5">{action}</div>}

        <ul className="mt-6 space-y-2.5 border-t border-[var(--color-sand)] pt-5 text-sm">
          {(tour?.timeSlot === 'sunset' ? cruiseIncluded : included).map(({ icon: Icon, label }) => (
            <li key={label} className="flex items-center gap-3">
              <Icon size={18} className="shrink-0 text-[var(--color-spring)]" />
              {label}
            </li>
          ))}
        </ul>

        <div className="mt-5 space-y-3 rounded-xl bg-[var(--color-paper)] p-4 text-sm">
          <p className="flex gap-3">
            <Shield size={18} className="mt-0.5 shrink-0 text-[var(--color-spring)]" />
            <span>
              <span className="font-medium">Full refund up to 72 hours before.</span>{' '}
              <span className="text-[var(--color-ink-soft)]">
                No refund after that. If Travis calls it for weather, you get
                everything back.
              </span>
            </span>
          </p>
          <p className="flex gap-3">
            <MapPin size={18} className="mt-0.5 shrink-0 text-[var(--color-spring)]" />
            <span>
              <span className="font-medium">{siteConfig.marina.name}</span>{' '}
              <span className="text-[var(--color-ink-soft)]">
                {siteConfig.marina.streetAddress}. Meet at the dock 15 minutes before
                your departure.
              </span>
            </span>
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * Phone-width version: a bar pinned to the bottom with the total and the
 * step's action. Tap the total to see the breakdown.
 */
export function MobileSummaryBar({ tour, date, guests, action }: Props) {
  const [open, setOpen] = useState(false);
  const { seasons } = useTourCatalog();
  const price = tour && date ? checkoutTotalFor(tour, guests, date, seasons) : null;
  const total = price?.total ?? null;
  const season = tour && date ? seasonFor(tour, date, seasons) : null;
  return (
    <div
      className="lg:hidden fixed inset-x-0 bottom-0 z-30 border-t border-[var(--color-sand)] bg-white/97 backdrop-blur-md shadow-[0_-8px_24px_-12px_rgba(14,32,30,0.25)]"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {open && tour && date && (
        <div className="border-b border-[var(--color-sand)] px-5 py-4 text-sm">
          <p className="font-semibold">
            {formatFriendlyDate(date).replace(/, \d{4}$/, '')} · {departureTimes(tour, date).start}
          </p>
          <p className="mt-0.5 text-[var(--color-ink-soft)]">
            {boatLabel(tour)} ·{' '}
            {tour.type === 'shared'
              ? `${formatPrice(unitPriceOn(tour, date, seasons))} × ${guests}`
              : `up to ${tour.maxGuests} guests`}
            {season && ` · ${season.name} rate`}
          </p>
          {price && (
            <p className="mt-0.5 text-[var(--color-ink-soft)] tabular-nums">
              {formatPrice(price.subtotal)} + {formatPrice(price.tax)} Florida sales tax
            </p>
          )}
          <p className="mt-2 text-xs text-[var(--color-ink-soft)]">
            Full refund up to 72 hours before. Weather cancellations always refunded.
          </p>
        </div>
      )}
      <div className="flex items-center gap-4 px-5 py-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          disabled={!tour}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left disabled:cursor-default"
        >
          <span className="min-w-0">
            <span className="block text-xs text-[var(--color-ink-soft)]">
              {tour ? `${guests} ${guests === 1 ? 'guest' : 'guests'} · total` : 'Pick a departure'}
            </span>
            <span className="block text-display text-[1.4rem] tabular-nums leading-tight">
              {total != null ? formatPrice(total) : '—'}
            </span>
          </span>
          {tour && (
            <ChevronDown
              size={18}
              className={clsx('shrink-0 text-[var(--color-ink-soft)] transition-transform', open && 'rotate-180')}
            />
          )}
        </button>
        <div className="shrink-0">{action}</div>
      </div>
    </div>
  );
}

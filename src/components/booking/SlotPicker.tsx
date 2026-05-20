'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  getDayAvailability,
  type SlotAvailability,
} from '@/lib/functions-client';
import { formatPrice, slotLabels, slotOrder, tours } from '@/lib/tours';
import type { MarketingTour, TourTimeSlot } from '@/lib/tours';
import { clsx } from '@/lib/clsx';

interface Props {
  date: string;
}

interface SlotView {
  slot: TourTimeSlot;
  sharedTour?: MarketingTour;
  privateTour?: MarketingTour;
}

const slotsByTimeSlot: SlotView[] = slotOrder.map((slot) => ({
  slot,
  sharedTour: tours.find((t) => t.timeSlot === slot && t.type === 'shared'),
  privateTour: tours.find((t) => t.timeSlot === slot && t.type === 'private'),
}));

const wholeDayTour = tours.find((t) => t.timeSlot === 'whole-day');

export function SlotPicker({ date }: Props) {
  const [data, setData] = useState<SlotAvailability[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadError(null);
    getDayAvailability(date, { signal: controller.signal })
      .then(({ slots }) => setData(slots))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setLoadError(
          err instanceof Error
            ? err.message
            : 'Could not load availability.',
        );
        // Optimistic fallback: assume every slot is wide open so the user can
        // still navigate forward; the createCheckoutSession transaction is the
        // authoritative gate.
        setData(
          slotOrder.map((slot) => ({
            timeSlot: slot,
            sharedRemaining: 6,
            privateAvailable: true,
            blackedOut: false,
            wholeDayBooked: false,
          })),
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [date]);

  const wholeDayAvailability = useMemo<SlotAvailability>(() => {
    if (!data) {
      return {
        timeSlot: 'whole-day',
        sharedRemaining: 0,
        privateAvailable: true,
        blackedOut: false,
        wholeDayBooked: false,
      };
    }
    // Whole-day private is available only if NO other slot has bookings AND
    // the day isn't blacked out. The function already tracks `wholeDayBooked`
    // but we still need to check whether any per-slot booking exists.
    const anyBooked = data.some(
      (s) => s.sharedRemaining < 6 || !s.privateAvailable,
    );
    const dayBlackedOut = data.some((s) => s.blackedOut);
    return {
      timeSlot: 'whole-day',
      sharedRemaining: 0,
      privateAvailable: !anyBooked && !dayBlackedOut,
      blackedOut: dayBlackedOut,
      wholeDayBooked: data.some((s) => s.wholeDayBooked),
    };
  }, [data]);

  return (
    <div className="space-y-8">
      {loadError && (
        <div className="rounded-2xl bg-[var(--color-coral)]/10 border border-[var(--color-coral)]/30 px-4 py-3 text-sm">
          We couldn&rsquo;t load real-time availability. You can still continue —
          we&rsquo;ll re-check spots when you go to pay.
        </div>
      )}

      <div className="grid gap-4">
        {slotsByTimeSlot.map(({ slot, sharedTour, privateTour }) => {
          const av = data?.find((d) => d.timeSlot === slot);
          return (
            <SlotCard
              key={slot}
              date={date}
              slot={slot}
              sharedTour={sharedTour}
              privateTour={privateTour}
              availability={av}
              loading={loading}
            />
          );
        })}
      </div>

      {wholeDayTour && (
        <div>
          <h2 className="font-display text-xl mb-3">Or take the whole day</h2>
          <SlotCard
            date={date}
            slot="whole-day"
            sharedTour={undefined}
            privateTour={wholeDayTour}
            availability={wholeDayAvailability}
            loading={loading}
          />
        </div>
      )}
    </div>
  );
}

function SlotCard({
  date,
  slot,
  sharedTour,
  privateTour,
  availability,
  loading,
}: {
  date: string;
  slot: TourTimeSlot;
  sharedTour?: MarketingTour;
  privateTour?: MarketingTour;
  availability?: SlotAvailability;
  loading: boolean;
}) {
  const closed =
    availability?.blackedOut || availability?.wholeDayBooked || false;

  const sharedRemaining = availability?.sharedRemaining ?? 6;
  const sharedOut = closed || sharedRemaining === 0;
  const privateAvailable =
    availability?.privateAvailable ?? !closed;

  // Show the tour's startTime to anchor the slot (any tour for this slot has
  // the same start time, so picking either is fine).
  const anyTour = sharedTour ?? privateTour!;
  const slotTimeRange = `${anyTour.startTimeDisplay} – ${anyTour.endTimeDisplay}`;

  return (
    <article
      className={clsx(
        'rounded-2xl bg-white border shadow-[var(--shadow-card)]',
        closed
          ? 'border-[var(--color-ink)]/10 opacity-60'
          : 'border-[var(--color-ink)]/8',
      )}
    >
      <header className="px-5 sm:px-6 py-4 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h3 className="font-display text-lg sm:text-xl">
            {slotLabels[slot]}
          </h3>
          <p className="text-sm text-[var(--color-ink-soft)] mt-0.5">
            {slotTimeRange}{slot !== 'whole-day' ? ` · ${anyTour.durationHours} hours` : ' · 8 hours'}
          </p>
        </div>
        {loading && (
          <span className="text-xs text-[var(--color-ink-soft)] animate-pulse">
            Checking availability…
          </span>
        )}
        {!loading && closed && (
          <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-[var(--color-ink)]/8 text-[var(--color-ink-soft)]">
            {availability?.wholeDayBooked
              ? 'Whole boat booked all day'
              : 'Closed this day'}
          </span>
        )}
      </header>

      <div
        className={clsx(
          'border-t border-[var(--color-ink)]/8 grid divide-y sm:divide-y-0',
          sharedTour && slot !== 'whole-day'
            ? 'sm:grid-cols-2 sm:divide-x divide-[var(--color-ink)]/8'
            : 'grid-cols-1',
        )}
      >
        {sharedTour && slot !== 'whole-day' && (
          <TourOption
            kind="shared"
            tour={sharedTour}
            date={date}
            disabled={sharedOut}
            statusText={
              sharedOut
                ? closed
                  ? 'Unavailable'
                  : 'Sold out'
                : `${sharedRemaining} of ${sharedTour.maxGuests} ${sharedRemaining === 1 ? 'spot' : 'spots'} left`
            }
          />
        )}
        {privateTour && (
          <TourOption
            kind="private"
            tour={privateTour}
            date={date}
            disabled={!privateAvailable}
            statusText={
              !privateAvailable
                ? closed
                  ? 'Unavailable'
                  : 'No longer available privately'
                : slot === 'whole-day'
                  ? 'Books the entire day'
                  : 'Books the whole boat for this slot'
            }
          />
        )}
      </div>
    </article>
  );
}

function TourOption({
  kind,
  tour,
  date,
  disabled,
  statusText,
}: {
  kind: 'shared' | 'private';
  tour: MarketingTour;
  date: string;
  disabled: boolean;
  statusText: string;
}) {
  const price =
    kind === 'shared' && tour.pricePerPerson != null
      ? `${formatPrice(tour.pricePerPerson)}/person`
      : tour.flatPrice != null
        ? `${formatPrice(tour.flatPrice)} flat`
        : '';

  const content = (
    <div className="px-5 sm:px-6 py-5 h-full flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-medium text-[var(--color-ink)]">
          {kind === 'private' ? 'Private — whole boat' : 'Shared'}
        </p>
        <p className="font-display text-lg text-[var(--color-brand-blue)]">
          {price}
        </p>
      </div>
      <p
        className={clsx(
          'text-sm',
          disabled
            ? 'text-[var(--color-ink-soft)]'
            : kind === 'private'
              ? 'text-[var(--color-coral-dark)]'
              : 'text-[var(--color-brand-blue-dark)]',
        )}
      >
        {statusText}
      </p>
      {!disabled && (
        <span className="mt-auto inline-flex items-center text-sm font-medium text-[var(--color-coral-dark)] group-hover:text-[var(--color-coral)]">
          Continue →
        </span>
      )}
    </div>
  );

  if (disabled) {
    return <div className="block cursor-not-allowed">{content}</div>;
  }
  return (
    <Link
      href={`/book/${date}/${tour.slug}`}
      className="block group hover:bg-[var(--color-cream)]/40 transition-colors"
    >
      {content}
    </Link>
  );
}

'use client';

import Link from 'next/link';
import { bookingHref, marinaNow, openDatesFrom } from '@/lib/availability';
import { getTourBySlug } from '@/lib/tours';
import { useUpcomingDays } from '@/components/booking/useUpcomingDays';
import { buttonClasses } from '@/components/ui/Button';
import { ArrowRight, Calendar } from '@/components/ui/icons';

function shortDate(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y!, m! - 1, d!);
  return {
    weekday: date.toLocaleDateString('en-US', { weekday: 'short' }),
    day: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
  };
}

/**
 * A tour's next bookable dates, read live in the browser (the tour page
 * itself is cached), each a one-tap link into the booking flow.
 */
export function NextOpenDates({ slug }: { slug: string }) {
  const tour = getTourBySlug(slug)!;
  const days = useUpcomingDays(45);
  const openDates = days ? openDatesFrom(tour, days, 6, marinaNow()) : null;

  return (
    <>
      <p className="flex items-center gap-2 font-semibold">
        <Calendar size={18} className="text-[var(--color-spring)]" />
        {openDates ? 'Next open dates' : 'Pick a date'}
      </p>
      {openDates && openDates.length > 0 && (
        <ul className="mt-4 grid grid-cols-3 gap-2">
          {openDates.map(({ date, seatsLeft }) => {
            const d = shortDate(date);
            return (
              <li key={date}>
                <Link
                  // The booking page assumes two guests; a date with one seat left has to say one.
                  href={bookingHref(tour, { date, guests: seatsLeft != null ? Math.min(2, seatsLeft) : undefined })}
                  className="block rounded-lg border border-[var(--color-sand)] bg-white px-2 py-2.5 text-center transition-colors hover:border-[var(--color-ink)]"
                >
                  <span className="block text-xs text-[var(--color-ink-soft)]">{d.weekday}</span>
                  <span className="block text-sm font-semibold">{d.day}</span>
                  {seatsLeft != null && seatsLeft <= 3 && (
                    <span className="block text-[0.7rem] font-medium text-[var(--color-buoy-deep)]">
                      {seatsLeft} left
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {openDates && openDates.length === 0 && (
        <p className="mt-3 text-sm text-[var(--color-ink-soft)]">
          Nothing open in the next few weeks. Check later dates, or call and
          Travis will find you something.
        </p>
      )}
      <Link href={bookingHref(tour)} className={buttonClasses({ size: 'lg', className: 'mt-5 w-full' })}>
        {openDates ? 'See all dates' : 'Check availability'}
        <ArrowRight size={18} />
      </Link>
    </>
  );
}

import type { Metadata } from 'next';
import { BookingCalendar } from '@/components/booking/BookingCalendar';
import { BookingSteps } from '@/components/booking/BookingSteps';
import { siteConfig } from '@/lib/site-config';

export const metadata: Metadata = {
  title: 'Book a Manatee Tour',
  description:
    'Pick a date to see available time slots, prices, and remaining spots on Crystal River Manatee Fun tours.',
  alternates: { canonical: `${siteConfig.url}/book` },
  robots: { index: false, follow: true },
};

export default function BookIndexPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
      <BookingSteps current={1} />

      <header className="mt-8 mb-6">
        <h1 className="font-display text-3xl sm:text-4xl leading-tight">
          Pick a date
        </h1>
        <p className="mt-2 text-[var(--color-ink-soft)]">
          Greyed-out days are closed for weather, maintenance, or already booked
          for the whole boat. Pick any open date to see the day&rsquo;s tours
          and availability.
        </p>
      </header>

      <BookingCalendar />

      <p className="mt-6 text-sm text-[var(--color-ink-soft)]">
        Looking for a tour today or tomorrow? Call{' '}
        <a
          href={siteConfig.contact.phoneHref}
          className="text-[var(--color-brand-blue)] hover:text-[var(--color-brand-blue-dark)] underline-offset-4 hover:underline"
        >
          {siteConfig.contact.phone}
        </a>{' '}
        — last-minute bookings are easier over the phone.
      </p>
    </div>
  );
}

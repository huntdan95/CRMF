import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BookingSteps } from '@/components/booking/BookingSteps';
import { DetailsForm } from '@/components/booking/DetailsForm';
import { Section } from '@/components/marketing/Section';
import { getTourBySlug, formatTourPrice, slotLabels } from '@/lib/tours';
import { formatFriendlyDate, parseIsoDate, startOfDay } from '@/lib/date';

interface PageProps {
  params: Promise<{ date: string; slug: string }>;
}

export const metadata: Metadata = {
  title: 'Your Details',
  robots: { index: false, follow: true },
};

export default async function DetailsPage({ params }: PageProps) {
  const { date, slug } = await params;
  const parsed = parseIsoDate(date);
  if (!parsed || parsed < startOfDay(new Date())) notFound();

  const tour = getTourBySlug(slug);
  if (!tour || !tour.active) notFound();

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
      <BookingSteps current={3} />

      <header className="mt-8 mb-6">
        <Link
          href={`/book/${date}`}
          className="text-sm text-[var(--color-brand-blue)] hover:text-[var(--color-brand-blue-dark)] underline-offset-4 hover:underline inline-flex items-center gap-1"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Change tour
        </Link>
        <h1 className="mt-3 font-display text-3xl sm:text-4xl leading-tight">
          {tour.name}
        </h1>
        <p className="mt-2 text-[var(--color-ink-soft)]">
          {formatFriendlyDate(date)} · {slotLabels[tour.timeSlot]} ·{' '}
          {tour.startTimeDisplay} – {tour.endTimeDisplay} · {formatTourPrice(tour)}
        </p>
      </header>

      <DetailsForm tour={tour} date={date} />

      <Section tone="cream" size="sm" className="!px-0 mt-12">
        <p className="text-xs text-[var(--color-ink-soft)] leading-relaxed">
          By submitting this form you authorize Crystal River Manatee Fun to
          charge your card for the total above. Payment is processed by Stripe;
          we never see or store your card details. You can manage or cancel
          your booking with the link in your confirmation email.
        </p>
      </Section>
    </div>
  );
}

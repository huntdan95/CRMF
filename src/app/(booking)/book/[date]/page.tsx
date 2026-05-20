import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BookingSteps } from '@/components/booking/BookingSteps';
import { SlotPicker } from '@/components/booking/SlotPicker';
import { formatFriendlyDate, parseIsoDate, startOfDay } from '@/lib/date';

interface PageProps {
  params: Promise<{ date: string }>;
}

export const metadata: Metadata = {
  title: 'Pick a Tour',
  robots: { index: false, follow: true },
};

export default async function DatePage({ params }: PageProps) {
  const { date } = await params;
  const parsed = parseIsoDate(date);
  if (!parsed) notFound();
  if (parsed < startOfDay(new Date())) notFound();

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
      <BookingSteps current={2} />

      <header className="mt-8 mb-6">
        <Link
          href="/book"
          className="text-sm text-[var(--color-brand-blue)] hover:text-[var(--color-brand-blue-dark)] underline-offset-4 hover:underline inline-flex items-center gap-1"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Change date
        </Link>
        <h1 className="mt-3 font-display text-3xl sm:text-4xl leading-tight">
          {formatFriendlyDate(date)}
        </h1>
        <p className="mt-2 text-[var(--color-ink-soft)]">
          Pick a slot. Shared tours fit up to six guests on the boat; private
          tours give your group the whole boat for that slot.
        </p>
      </header>

      <SlotPicker date={date} />
    </div>
  );
}

import type { Metadata } from 'next';
import { MyBookingView } from '@/components/booking/MyBookingView';

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ t?: string }>;
}

export const metadata: Metadata = {
  title: 'Manage Your Booking',
  robots: { index: false, follow: false },
};

export default async function MyBookingPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const { t } = await searchParams;

  return (
    <div className="mx-auto max-w-3xl px-5 pb-20 pt-10 sm:px-8 sm:pt-14">
      <header className="mb-8">
        <h1 className="text-display text-[2.4rem] sm:text-[3.25rem]">Your booking</h1>
        <p className="mt-3 text-lg text-[var(--color-ink-soft)]">
          Check the details, cancel, or ask for a different date. This link
          came in your confirmation email; bookmark it.
        </p>
      </header>

      <MyBookingView bookingId={id} accessToken={t ?? null} />
    </div>
  );
}

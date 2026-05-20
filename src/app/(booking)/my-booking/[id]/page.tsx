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

export default async function MyBookingPage({
  params,
  searchParams,
}: PageProps) {
  const { id } = await params;
  const { t } = await searchParams;

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
      <header className="mb-6">
        <h1 className="font-display text-3xl sm:text-4xl leading-tight">
          Your booking
        </h1>
        <p className="mt-2 text-[var(--color-ink-soft)]">
          Manage, cancel, or request a reschedule. This link was emailed to you
          when you booked — bookmark it.
        </p>
      </header>

      <MyBookingView bookingId={id} accessToken={t ?? null} />
    </div>
  );
}

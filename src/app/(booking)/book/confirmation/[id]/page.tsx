import type { Metadata } from 'next';
import { BookingSteps } from '@/components/booking/BookingSteps';
import { ConfirmationView } from '@/components/booking/ConfirmationView';

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ t?: string }>;
}

export const metadata: Metadata = {
  title: 'Booking Confirmation',
  robots: { index: false, follow: false },
};

export default async function ConfirmationPage({
  params,
  searchParams,
}: PageProps) {
  const { id } = await params;
  const { t } = await searchParams;

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
      <BookingSteps current={4} />

      <header className="mt-8 mb-6">
        <h1 className="font-display text-3xl sm:text-4xl leading-tight">
          All set
        </h1>
      </header>

      <ConfirmationView bookingId={id} accessToken={t ?? null} />
    </div>
  );
}

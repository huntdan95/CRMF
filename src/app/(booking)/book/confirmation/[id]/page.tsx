import type { Metadata } from 'next';
import { StepIndicator } from '@/components/booking/Controls';
import { ConfirmationView } from '@/components/booking/ConfirmationView';

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ t?: string }>;
}

export const metadata: Metadata = {
  title: 'Booking Confirmation',
  robots: { index: false, follow: false },
};

export default async function ConfirmationPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const { t } = await searchParams;

  return (
    <div className="mx-auto max-w-3xl px-5 pb-20 pt-8 sm:px-8 sm:pt-10">
      <StepIndicator step={4} />
      <h1 className="sr-only">Booking confirmation</h1>
      <div className="mt-8">
        <ConfirmationView bookingId={id} accessToken={t ?? null} />
      </div>
    </div>
  );
}

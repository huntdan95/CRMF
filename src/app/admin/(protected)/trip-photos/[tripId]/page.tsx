import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { TripPhotosAdmin } from '@/components/admin/TripPhotosAdmin';

export const metadata: Metadata = {
  title: 'Trip photos — Admin',
  robots: { index: false, follow: false },
};

export default async function TripPhotosForTripPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  if (!/^\d{4}-\d{2}-\d{2}_[a-z-]+$/.test(tripId)) notFound();
  return (
    <div className="max-w-4xl mx-auto">
      <TripPhotosAdmin tripId={tripId} />
    </div>
  );
}

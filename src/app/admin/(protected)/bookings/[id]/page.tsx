import type { Metadata } from 'next';
import Link from 'next/link';
import { BookingDetail } from '@/components/admin/BookingDetail';

interface PageProps {
  params: Promise<{ id: string }>;
}

export const metadata: Metadata = {
  title: 'Booking — Admin',
  robots: { index: false, follow: false },
};

export default async function AdminBookingDetailPage({ params }: PageProps) {
  const { id } = await params;
  return (
    <div className="max-w-4xl mx-auto">
      <Link
        href="/admin/bookings"
        className="text-sm text-[var(--color-brand-blue)] hover:text-[var(--color-brand-blue-dark)] underline-offset-4 hover:underline inline-flex items-center gap-1 mb-3"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Back to bookings
      </Link>
      <BookingDetail bookingId={id} />
    </div>
  );
}

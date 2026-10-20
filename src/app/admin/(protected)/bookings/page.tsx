import type { Metadata } from 'next';
import { BookingsList } from '@/components/admin/BookingsList';
import { AdminPageHeader } from '@/components/admin/ui';

export const metadata: Metadata = {
  title: 'Bookings — Admin',
  robots: { index: false, follow: false },
};

export default function BookingsListPage() {
  return (
    <div className="max-w-4xl mx-auto">
      <AdminPageHeader
        title="Bookings"
        description={
          <>
            Upcoming tours first. Tap a booking to open it.
          </>
        }
      />
      <BookingsList />
    </div>
  );
}

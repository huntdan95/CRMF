import type { Metadata } from 'next';
import { BlackoutsAdmin } from '@/components/admin/BlackoutsAdmin';
import { AdminPageHeader } from '@/components/admin/ui';

export const metadata: Metadata = {
  title: 'Close a day — Admin',
  robots: { index: false, follow: false },
};

export default function BlackoutsPage() {
  return (
    <div className="max-w-4xl mx-auto">
      <AdminPageHeader
        title="Close a day"
        description={
          <>
            Stop online bookings for a day or a departure, for weather, boat
            trouble or time off. You’ll see who’s already booked before
            anything happens.
          </>
        }
      />
      <BlackoutsAdmin />
    </div>
  );
}

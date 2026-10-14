import type { Metadata } from 'next';
import { AdminCalendar } from '@/components/admin/AdminCalendar';
import { AdminDashboardStats } from '@/components/admin/AdminDashboardStats';
import { AdminPageHeader } from '@/components/admin/ui';

export const metadata: Metadata = {
  title: 'Dashboard — Admin',
  robots: { index: false, follow: false },
};

// Dashboard stats are recomputed on each request — this is admin-only,
// traffic is one user, no caching needed.
export const dynamic = 'force-dynamic';

export default function AdminCalendarPage() {
  return (
    <div className="max-w-6xl mx-auto">
      <AdminPageHeader
        title="Dashboard"
        description={
          <>
            Who’s coming today and tomorrow, and how the month is going. Tap
            a name to open their booking.
          </>
        }
      />
      <AdminDashboardStats />
      <AdminCalendar />
    </div>
  );
}

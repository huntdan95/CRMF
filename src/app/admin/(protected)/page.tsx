import type { Metadata } from 'next';
import Link from 'next/link';
import { AdminCalendar } from '@/components/admin/AdminCalendar';
import { AdminDashboardStats } from '@/components/admin/AdminDashboardStats';
import { PendingClosuresBanner } from '@/components/admin/PendingClosuresBanner';
import { AdminPageHeader, buttonClass } from '@/components/admin/ui';
import { marinaNow } from '@/lib/availability';
import { clsx } from '@/lib/clsx';

export const metadata: Metadata = {
  title: 'Dashboard — Admin',
  robots: { index: false, follow: false },
};

// Dashboard stats are recomputed on each request — this is admin-only,
// traffic is one user, no caching needed.
export const dynamic = 'force-dynamic';

export default function AdminCalendarPage() {
  const today = marinaNow().date;
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
      >
        <Link
          href={`/admin/blackouts?date=${today}&reason=weather`}
          className={clsx(buttonClass('destructive'), 'mt-4 w-full sm:w-auto min-h-12 text-base')}
        >
          Weather cancel
        </Link>
      </AdminPageHeader>
      <PendingClosuresBanner />
      <AdminDashboardStats />
      <AdminCalendar />
    </div>
  );
}

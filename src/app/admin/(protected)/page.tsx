import type { Metadata } from 'next';
import { AdminCalendar } from '@/components/admin/AdminCalendar';
import { AdminDashboardStats } from '@/components/admin/AdminDashboardStats';

export const metadata: Metadata = {
  title: 'Calendar — Admin',
  robots: { index: false, follow: false },
};

// Dashboard stats are recomputed on each request — this is admin-only,
// traffic is one user, no caching needed.
export const dynamic = 'force-dynamic';

export default function AdminCalendarPage() {
  return (
    <div className="max-w-6xl mx-auto">
      <header className="mb-6 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-display text-[2rem] sm:text-[2.5rem]">
            Dashboard
          </h1>
          <p className="text-[var(--color-ink-soft)] mt-1 text-sm">
            Today, this week, this month, and the next tour on the books.
            Click a calendar event to open the booking.
          </p>
        </div>
      </header>
      <AdminDashboardStats />
      <AdminCalendar />
    </div>
  );
}

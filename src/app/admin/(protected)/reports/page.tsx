import type { Metadata } from 'next';
import { ReportsAdmin } from '@/components/admin/ReportsAdmin';

export const metadata: Metadata = {
  title: 'Reports — Admin',
  robots: { index: false, follow: false },
};

export default function ReportsPage() {
  return (
    <div className="max-w-5xl mx-auto">
      <header className="mb-6">
        <h1 className="text-display text-[2rem] sm:text-[2.5rem]">Reports</h1>
        <p className="text-[var(--color-ink-soft)] mt-1 text-sm">
          Bookings and revenue for a chosen date range. Export CSV for your
          accountant.
        </p>
      </header>
      <ReportsAdmin />
    </div>
  );
}

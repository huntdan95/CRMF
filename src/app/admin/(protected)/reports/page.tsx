import type { Metadata } from 'next';
import { ReportsAdmin } from '@/components/admin/ReportsAdmin';
import { AdminPageHeader } from '@/components/admin/ui';

export const metadata: Metadata = {
  title: 'Reports — Admin',
  robots: { index: false, follow: false },
};

export default function ReportsPage() {
  return (
    <div className="max-w-5xl mx-auto">
      <AdminPageHeader
        title="Reports"
        description={
          <>
            Bookings and what customers paid for a chosen date range, with the
            Florida sales tax in it shown apart: it’s owed to the state, not
            yours. Export CSV for your accountant.
          </>
        }
      />
      <ReportsAdmin />
    </div>
  );
}

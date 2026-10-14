import type { Metadata } from 'next';
import { ReschedulesAdmin } from '@/components/admin/ReschedulesAdmin';
import { AdminPageHeader } from '@/components/admin/ui';

export const metadata: Metadata = {
  title: 'Reschedule requests — Admin',
  robots: { index: false, follow: false },
};

export default function ReschedulesPage() {
  return (
    <div className="max-w-5xl mx-auto">
      <AdminPageHeader
        title="Reschedule requests"
        description={
          <>
            Customers can ask to move their tour from the link in their
            confirmation email. Their requests land here. To move a booking,
            open it and use “Move to another day or tour”.
          </>
        }
      />
      <ReschedulesAdmin />
    </div>
  );
}

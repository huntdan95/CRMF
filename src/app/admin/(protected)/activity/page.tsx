import type { Metadata } from 'next';
import { ActivityAdmin } from '@/components/admin/ActivityAdmin';
import { AdminPageHeader } from '@/components/admin/ui';

export const metadata: Metadata = {
  title: 'Activity — Admin',
  robots: { index: false, follow: false },
};

export default function ActivityPage() {
  return (
    <div className="max-w-3xl mx-auto">
      <AdminPageHeader
        title="Activity"
        description={
          <>
            A record of every change made here in the admin: cancellations,
            refunds, closed days, photos and more, newest first. Use it to look
            back at what happened and when. Nothing on this page can be changed.
          </>
        }
      />
      <ActivityAdmin />
    </div>
  );
}

import type { Metadata } from 'next';
import { SettingsAdmin } from '@/components/admin/SettingsAdmin';
import { AdminPageHeader } from '@/components/admin/ui';

export const metadata: Metadata = {
  title: 'Settings — Admin',
  robots: { index: false, follow: false },
};

export default function SettingsPage() {
  return (
    <div className="max-w-3xl mx-auto">
      <AdminPageHeader
        title="Settings"
        description={
          <>
            Wording customers see on the website, and how long you have to
            undo closing a day.
          </>
        }
      />
      <SettingsAdmin />
    </div>
  );
}

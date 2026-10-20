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
            Wording customers see on the website, the Google review link, the
            wetsuit sizes guests pick from, how long you have to undo closing
            a day, and the Google Drive trip photos copy into.
          </>
        }
      />
      <SettingsAdmin />
    </div>
  );
}

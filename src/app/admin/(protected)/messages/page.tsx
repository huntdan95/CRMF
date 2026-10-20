import type { Metadata } from 'next';
import { MessagesAdmin } from '@/components/admin/MessagesAdmin';
import { AdminPageHeader } from '@/components/admin/ui';

export const metadata: Metadata = {
  title: 'Messages — Admin',
  robots: { index: false, follow: false },
};

export default function MessagesPage() {
  return (
    <div className="max-w-5xl mx-auto">
      <AdminPageHeader
        title="Messages"
        description={
          <>
            Submissions from the contact form. Every new one also emails you
            directly — this page lets you mark them as replied or archived
            so the inbox stays manageable.
          </>
        }
      />
      <MessagesAdmin />
    </div>
  );
}

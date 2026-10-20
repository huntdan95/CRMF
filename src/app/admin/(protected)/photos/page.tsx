import type { Metadata } from 'next';
import { PhotosAdmin } from '@/components/admin/PhotosAdmin';
import { AdminPageHeader } from '@/components/admin/ui';

export const metadata: Metadata = {
  title: 'Photos — Admin',
  robots: { index: false, follow: false },
};

export default function PhotosPage() {
  return (
    <div className="max-w-4xl mx-auto">
      <AdminPageHeader
        title="Photos"
        description={
          <>
            The photos on your website, and where each one shows.
          </>
        }
      />
      <PhotosAdmin />
    </div>
  );
}

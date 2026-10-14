import type { Metadata } from 'next';
import { ReviewsAdmin } from '@/components/admin/ReviewsAdmin';
import { AdminPageHeader } from '@/components/admin/ui';

export const metadata: Metadata = {
  title: 'Reviews — Admin',
  robots: { index: false, follow: false },
};

export default function ReviewsAdminPage() {
  return (
    <div className="max-w-4xl mx-auto">
      <AdminPageHeader
        title="Reviews"
        description={
          <>
            Add reviews you&rsquo;ve collected from guests, Google, Tripadvisor,
            Instagram, etc. Featured + published reviews appear on the home
            page; all published reviews show on /reviews. Drafts (unpublished)
            show nowhere.
          </>
        }
      />
      <ReviewsAdmin />
    </div>
  );
}

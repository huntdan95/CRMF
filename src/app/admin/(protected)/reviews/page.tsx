import type { Metadata } from 'next';
import { ReviewsAdmin } from '@/components/admin/ReviewsAdmin';

export const metadata: Metadata = {
  title: 'Reviews — Admin',
  robots: { index: false, follow: false },
};

export default function ReviewsAdminPage() {
  return (
    <div className="max-w-4xl mx-auto">
      <header className="mb-6">
        <h1 className="font-display text-3xl sm:text-4xl leading-tight">Reviews</h1>
        <p className="text-[var(--color-ink-soft)] mt-1 text-sm">
          Add reviews you&rsquo;ve collected from guests, Google, Tripadvisor,
          Instagram, etc. Featured + published reviews appear on the home
          page; all published reviews show on /reviews. Drafts (unpublished)
          show nowhere.
        </p>
      </header>
      <ReviewsAdmin />
    </div>
  );
}

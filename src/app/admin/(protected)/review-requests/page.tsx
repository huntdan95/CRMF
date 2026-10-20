import type { Metadata } from 'next';
import { ReviewRequestsAdmin } from '@/components/admin/ReviewRequestsAdmin';

export const metadata: Metadata = {
  title: 'Review requests — Admin',
  robots: { index: false, follow: false },
};

export default function ReviewRequestsPage() {
  return (
    <div className="max-w-3xl mx-auto">
      <header className="mb-6">
        <h1 className="text-display text-[2rem] sm:text-[2.5rem]">Review requests</h1>
        <p className="text-[var(--color-ink-soft)] mt-1 text-sm">
          Today’s guests get the thank-you email with your Google review link
          at 7:00 PM. You get this list at 6:00.
        </p>
      </header>
      <ReviewRequestsAdmin />
    </div>
  );
}

import type { Metadata } from 'next';
import { ToursAdmin } from '@/components/admin/ToursAdmin';

export const metadata: Metadata = {
  title: 'Tours — Admin',
  robots: { index: false, follow: false },
};

export default function ToursAdminPage() {
  return (
    <div className="max-w-4xl mx-auto">
      <header className="mb-6">
        <h1 className="font-display text-3xl sm:text-4xl leading-tight">Tours</h1>
        <p className="text-[var(--color-ink-soft)] mt-1 text-sm">
          Edit price, description, included items, or take a tour offline.
          Schedule and slot names live in the seed script — talk to dev if you
          need to change those.
        </p>
      </header>
      <ToursAdmin />
    </div>
  );
}

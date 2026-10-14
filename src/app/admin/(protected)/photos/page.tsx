import type { Metadata } from 'next';
import { PhotosAdmin } from '@/components/admin/PhotosAdmin';

export const metadata: Metadata = {
  title: 'Photos — Admin',
  robots: { index: false, follow: false },
};

export default function PhotosPage() {
  return (
    <div className="max-w-4xl mx-auto">
      <header className="mb-6">
        <h1 className="text-display text-[2rem] sm:text-[2.5rem]">Photos</h1>
        <p className="text-[var(--color-ink-soft)] mt-1 text-sm">
          Upload the five photo slots used across the public site. Changes
          appear on the next page load — no rebuild required.
        </p>
      </header>
      <PhotosAdmin />
    </div>
  );
}

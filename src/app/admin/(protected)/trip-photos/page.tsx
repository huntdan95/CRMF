import type { Metadata } from 'next';
import { TripPhotosList } from '@/components/admin/TripPhotosAdmin';

export const metadata: Metadata = {
  title: 'Trip photos — Admin',
  robots: { index: false, follow: false },
};

export default function TripPhotosPage() {
  return (
    <div className="max-w-3xl mx-auto">
      <header className="mb-6">
        <h1 className="text-display text-[2rem] sm:text-[2.5rem]">Trip photos</h1>
        <p className="text-[var(--color-ink-soft)] mt-1 text-sm">
          What the crew uploaded for each trip. Guests get an email with their
          trip’s photos at 9:00 the next morning, or an hour after the last
          upload if that’s later. Tap a trip to see its photos, delete one, or
          get its upload link.
        </p>
      </header>
      <TripPhotosList />
    </div>
  );
}

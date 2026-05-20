import type { Metadata } from 'next';
import { BookingsList } from '@/components/admin/BookingsList';

export const metadata: Metadata = {
  title: 'Bookings — Admin',
  robots: { index: false, follow: false },
};

export default function BookingsListPage() {
  return (
    <div className="max-w-6xl mx-auto">
      <header className="mb-6">
        <h1 className="font-display text-3xl sm:text-4xl leading-tight">Bookings</h1>
        <p className="text-[var(--color-ink-soft)] mt-1 text-sm">
          Most recent first. Click a row to open.
        </p>
      </header>
      <BookingsList />
    </div>
  );
}

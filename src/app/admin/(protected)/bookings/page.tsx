import type { Metadata } from 'next';
import { BookingsList } from '@/components/admin/BookingsList';

export const metadata: Metadata = {
  title: 'Bookings — Admin',
  robots: { index: false, follow: false },
};

export default function BookingsListPage() {
  return (
    <div className="max-w-4xl mx-auto">
      <header className="mb-6">
        <h1 className="text-display text-[2rem] sm:text-[2.5rem]">Bookings</h1>
        <p className="text-[var(--color-ink-soft)] mt-1 text-sm">
          Upcoming tours first. Tap a booking to open it.
        </p>
      </header>
      <BookingsList />
    </div>
  );
}

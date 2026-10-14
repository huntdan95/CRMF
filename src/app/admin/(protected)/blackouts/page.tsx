import type { Metadata } from 'next';
import { BlackoutsAdmin } from '@/components/admin/BlackoutsAdmin';

export const metadata: Metadata = {
  title: 'Close a day — Admin',
  robots: { index: false, follow: false },
};

export default function BlackoutsPage() {
  return (
    <div className="max-w-4xl mx-auto">
      <header className="mb-6">
        <h1 className="text-display text-[2rem] sm:text-[2.5rem]">Close a day</h1>
        <p className="text-[var(--color-ink-soft)] mt-1 text-sm">
          Stop online bookings for a day or a departure, for weather, boat
          trouble or time off. You’ll see who’s already booked before
          anything happens.
        </p>
      </header>
      <BlackoutsAdmin />
    </div>
  );
}

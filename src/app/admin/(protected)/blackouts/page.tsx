import type { Metadata } from 'next';
import { BlackoutsAdmin } from '@/components/admin/BlackoutsAdmin';

export const metadata: Metadata = {
  title: 'Blackouts — Admin',
  robots: { index: false, follow: false },
};

export default function BlackoutsPage() {
  return (
    <div className="max-w-4xl mx-auto">
      <header className="mb-6">
        <h1 className="font-display text-3xl sm:text-4xl leading-tight">Blackouts</h1>
        <p className="text-[var(--color-ink-soft)] mt-1 text-sm">
          Close days or specific slots for weather, maintenance, or personal
          time. Optionally cancel and refund affected bookings.
        </p>
      </header>
      <BlackoutsAdmin />
    </div>
  );
}

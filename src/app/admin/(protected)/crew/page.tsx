import type { Metadata } from 'next';
import { CrewAdmin } from '@/components/admin/CrewAdmin';

export const metadata: Metadata = {
  title: 'Crew — Admin',
  robots: { index: false, follow: false },
};

export default function CrewPage() {
  return (
    <div className="max-w-3xl mx-auto">
      <header className="mb-6">
        <h1 className="text-display text-[2rem] sm:text-[2.5rem]">Crew</h1>
        <p className="text-[var(--color-ink-soft)] mt-1 text-sm">
          Swim guides and mates you add here sign in at{' '}
          <code className="font-mono text-xs">/crew</code> on their phone to
          see confirmed upcoming tours and get a notification whenever a tour
          is booked. They can’t see customer details or change anything.
        </p>
      </header>
      <CrewAdmin />
    </div>
  );
}

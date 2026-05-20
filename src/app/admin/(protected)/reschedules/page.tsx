import type { Metadata } from 'next';
import { ReschedulesAdmin } from '@/components/admin/ReschedulesAdmin';

export const metadata: Metadata = {
  title: 'Reschedule requests — Admin',
  robots: { index: false, follow: false },
};

export default function ReschedulesPage() {
  return (
    <div className="max-w-5xl mx-auto">
      <header className="mb-6">
        <h1 className="font-display text-3xl sm:text-4xl leading-tight">
          Reschedule requests
        </h1>
        <p className="text-[var(--color-ink-soft)] mt-1 text-sm">
          When a customer asks to move their tour via{' '}
          <code className="font-mono text-xs">/my-booking/[id]</code>, it
          lands here. Open the booking to actually move it; this page is
          for tracking the back-and-forth.
        </p>
      </header>
      <ReschedulesAdmin />
    </div>
  );
}

import type { Metadata } from 'next';
import { CrewAdmin } from '@/components/admin/CrewAdmin';
import { AdminPageHeader } from '@/components/admin/ui';

export const metadata: Metadata = {
  title: 'Crew — Admin',
  robots: { index: false, follow: false },
};

export default function CrewPage() {
  return (
    <div className="max-w-3xl mx-auto">
      <AdminPageHeader
        title="Crew"
        description={
          <>
            Swim guides and mates you add here sign in at{' '}
            <code className="font-mono text-xs">/crew</code> on their phone to
            see confirmed upcoming tours and get a notification whenever a tour
            is booked. They can’t see customer details or change anything.
            <span className="block mt-2">
              <strong className="font-semibold text-[var(--color-ink)]">Send calendar link</strong>{' '}
              emails them a link that puts every booked trip in their phone’s
              calendar, with times and headcounts only. Sending a new one stops
              the old one.
            </span>
          </>
        }
      />
      <CrewAdmin />
    </div>
  );
}

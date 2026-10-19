import type { Metadata } from 'next';
import { CrewAdmin } from '@/components/admin/CrewAdmin';
import { TripCrewAdmin } from '@/components/admin/TripCrewAdmin';
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
            Running a small trip yourself? Switch its crew off below.
          </>
        }
      />
      <div className="space-y-6">
        <TripCrewAdmin />
        <CrewAdmin />
      </div>
    </div>
  );
}

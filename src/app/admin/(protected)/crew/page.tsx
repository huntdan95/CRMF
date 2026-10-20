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
            Everyone here with an email and crew emails on gets an email for
            each new booking, cancellation and reschedule request, and
            tomorrow’s trips every evening at 8. The subjects start with
            “[CRMF]” so you can set phone alerts for them. These emails include
            the lead guest’s name and phone number.
            <span className="block mt-2">
              Give someone an app password and they can also sign in at{' '}
              <code className="font-mono text-xs">/crew</code> on their phone to
              see upcoming tours and get a notification whenever a tour is
              booked. The app shows no customer details, and they can’t change
              anything. Running a small trip yourself? Switch its crew off below.
            </span>
            <span className="block mt-2">
              <strong className="font-semibold text-[var(--color-ink)]">Send calendar link</strong>{' '}
              emails them a link that puts every booked trip in their phone’s
              calendar, with times and headcounts only. Sending a new one stops
              the old one.
            </span>
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

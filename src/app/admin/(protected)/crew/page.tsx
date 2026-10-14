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
          Everyone here with an email and crew emails on gets an email for
          each new booking, cancellation and reschedule request, and
          tomorrow’s trips every evening at 8. The subjects start with
          “[CRMF]” so you can set phone alerts for them. These emails include
          the lead guest’s name and phone number.
        </p>
        <p className="text-[var(--color-ink-soft)] mt-2 text-sm">
          Give someone an app password and they can also sign in at{' '}
          <code className="font-mono text-xs">/crew</code> on their phone to
          see upcoming tours and get a notification whenever a tour is booked.
          The app shows no customer details, and they can’t change anything.
        </p>
      </header>
      <CrewAdmin />
    </div>
  );
}

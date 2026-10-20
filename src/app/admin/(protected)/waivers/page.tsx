import type { Metadata } from 'next';
import { WaiversAdmin } from '@/components/admin/WaiversAdmin';

export const metadata: Metadata = {
  title: 'Waivers — Admin',
  robots: { index: false, follow: false },
};

export default function WaiversPage() {
  return (
    <div className="max-w-4xl mx-auto">
      <header className="mb-6">
        <h1 className="text-display text-[2rem] sm:text-[2.5rem]">Waivers</h1>
        <p className="text-[var(--color-ink-soft)] mt-1 text-sm">
          Who on each trip has signed. Guests sign on their phones from the link in their
          confirmation email; open a booking to text the link to anyone who hasn’t.
        </p>
        <p className="text-[var(--color-ink-soft)] mt-2 text-sm">
          At the dock, no one boards without a signed waiver. Anyone still missing signs on your
          phone or tablet from the booking’s “Open signing page”. A guest who won’t sign
          electronically signs the{' '}
          <a href="/admin/waivers/paper" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
            paper copy
          </a>{' '}
          (same wording); keep it with your records, because it won’t show here.
        </p>
      </header>
      <WaiversAdmin />
    </div>
  );
}

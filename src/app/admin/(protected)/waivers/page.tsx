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
      </header>
      <WaiversAdmin />
    </div>
  );
}

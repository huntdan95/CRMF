import type { Metadata } from 'next';
import { ActivityAdmin } from '@/components/admin/ActivityAdmin';

export const metadata: Metadata = {
  title: 'Activity — Admin',
  robots: { index: false, follow: false },
};

export default function ActivityPage() {
  return (
    <div className="max-w-3xl mx-auto">
      <header className="mb-6">
        <h1 className="text-display text-[2rem] sm:text-[2.5rem]">
          Activity
        </h1>
        <p className="text-[var(--color-ink-soft)] mt-1 text-sm">
          A record of every change made here in the admin: cancellations,
          refunds, closed days, photos and more, newest first. Use it to look
          back at what happened and when. Nothing on this page can be changed.
        </p>
      </header>
      <ActivityAdmin />
    </div>
  );
}

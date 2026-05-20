import type { Metadata } from 'next';
import { ActivityAdmin } from '@/components/admin/ActivityAdmin';

export const metadata: Metadata = {
  title: 'Activity — Admin',
  robots: { index: false, follow: false },
};

export default function ActivityPage() {
  return (
    <div className="max-w-5xl mx-auto">
      <header className="mb-6">
        <h1 className="font-display text-3xl sm:text-4xl leading-tight">
          Activity
        </h1>
        <p className="text-[var(--color-ink-soft)] mt-1 text-sm">
          Every admin action — booking edits, refunds, photo uploads,
          tour changes — gets logged here. Read-only; use it to retrace
          what happened when.
        </p>
      </header>
      <ActivityAdmin />
    </div>
  );
}

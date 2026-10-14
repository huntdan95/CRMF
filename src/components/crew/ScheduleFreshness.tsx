'use client';

import { useEffect, useTransition } from 'react';
import { useRouter } from 'next/navigation';

/**
 * "Updated 8:42 PM · Refresh". Also re-reads the schedule whenever the app
 * comes back into view — a home-screen app has no reload button, and a
 * phone can keep it suspended for days.
 */
export function ScheduleFreshness({ updatedAt }: { updatedAt: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === 'visible') {
        startTransition(() => router.refresh());
      }
    }
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [router]);

  return (
    <p className="text-xs text-[var(--color-ink-soft)]" aria-live="polite">
      {pending ? 'Updating…' : `Updated ${updatedAt}`}
      {' · '}
      <button
        type="button"
        onClick={() => startTransition(() => router.refresh())}
        disabled={pending}
        className="font-semibold text-[var(--color-spring)] underline-offset-2 hover:underline disabled:opacity-60"
      >
        Refresh
      </button>
    </p>
  );
}

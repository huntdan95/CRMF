'use client';

import { useEffect, useTransition } from 'react';
import { useRouter } from 'next/navigation';

/**
 * "Updated 8:42 PM" and a refresh button, for the header. Also re-reads
 * the schedule whenever the app comes back into view — a home-screen app
 * has no reload button, and a phone can keep it suspended for days.
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
    <div className="flex items-center gap-2">
      <span className="whitespace-nowrap text-xs text-white/70" aria-live="polite">
        {pending ? (
          'Updating…'
        ) : (
          <>
            {/* The smallest phones only have room for the time. */}
            <span className="max-[359px]:sr-only">Updated </span>
            {updatedAt}
          </>
        )}
      </span>
      <button
        type="button"
        onClick={() => startTransition(() => router.refresh())}
        disabled={pending}
        aria-label="Refresh"
        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/25 text-white hover:bg-white/10 disabled:opacity-60"
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
          className={pending ? 'animate-spin' : undefined}
        >
          <path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v4h-4" />
        </svg>
      </button>
    </div>
  );
}

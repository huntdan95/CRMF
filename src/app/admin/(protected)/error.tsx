'use client';

import { useEffect } from 'react';

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Admin error:', error);
  }, [error]);

  return (
    <div className="max-w-2xl mx-auto py-12">
      <div className="rounded-2xl bg-[var(--color-coral)]/10 border border-[var(--color-coral)]/30 p-6">
        <h2 className="font-display text-2xl">This page didn’t load</h2>
        <p className="mt-2 text-sm">
          Tap “Try again”. If it keeps happening, check your signal, or sign
          out and back in from the menu.
        </p>
        <p className="mt-3 text-xs text-[var(--color-ink-soft)] break-words">
          For your web developer: {error.message || 'Unexpected error.'}
          {error.digest && ` (ref ${error.digest})`}
        </p>
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={reset}
            className="px-5 py-3 rounded-[10px] bg-[var(--color-brand-blue)] hover:bg-[var(--color-brand-blue-dark)] text-white text-sm"
          >
            Try again
          </button>
        </div>
      </div>
    </div>
  );
}

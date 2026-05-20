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
        <h2 className="font-display text-2xl">Admin error</h2>
        <p className="mt-2 text-sm">
          {error.message || 'Unexpected error.'}
        </p>
        {error.digest && (
          <p className="mt-1 text-xs font-mono text-[var(--color-ink-soft)]">
            Ref: {error.digest}
          </p>
        )}
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={reset}
            className="px-4 py-2 rounded-full bg-[var(--color-brand-blue)] hover:bg-[var(--color-brand-blue-dark)] text-white text-sm"
          >
            Retry
          </button>
        </div>
      </div>
    </div>
  );
}

'use client';

import { useEffect } from 'react';
import { siteConfig } from '@/lib/site-config';

export default function BookingError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Booking flow error:', error);
  }, [error]);

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12">
      <div className="rounded-2xl bg-[var(--color-coral)]/10 border border-[var(--color-coral)]/30 p-6">
        <h2 className="font-display text-2xl text-[var(--color-coral-dark)]">
          Booking hit a snag
        </h2>
        <p className="mt-2 text-sm">
          Don&rsquo;t worry — no payment has been taken. Try again, or call
          Travis at{' '}
          <a
            href={siteConfig.contact.phoneHref}
            className="text-[var(--color-brand-blue)] hover:text-[var(--color-brand-blue-dark)] underline"
          >
            {siteConfig.contact.phone}
          </a>{' '}
          and he&rsquo;ll get you on the boat the old-fashioned way.
        </p>
        {error.digest && (
          <p className="mt-2 text-xs font-mono text-[var(--color-ink-soft)]">
            Error ref: {error.digest}
          </p>
        )}
        <div className="mt-4">
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center justify-center px-5 py-2.5 rounded-full bg-[var(--color-coral)] hover:bg-[var(--color-coral-dark)] text-white font-medium"
          >
            Try again
          </button>
        </div>
      </div>
    </div>
  );
}

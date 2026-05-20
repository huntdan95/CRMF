'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { siteConfig } from '@/lib/site-config';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // In production this routes to Firebase App Hosting logs.
    console.error('Unhandled error:', error);
  }, [error]);

  return (
    <main className="min-h-screen flex items-center justify-center bg-[var(--color-cream)] px-4">
      <div className="max-w-md text-center">
        <p className="text-sm font-medium uppercase tracking-widest text-[var(--color-coral-dark)]">
          Something went sideways
        </p>
        <h1 className="mt-2 font-display text-3xl sm:text-4xl leading-tight">
          That wasn&rsquo;t supposed to happen.
        </h1>
        <p className="mt-4 text-[var(--color-ink-soft)]">
          We&rsquo;ve logged the error. Try again in a moment, or call us if it
          keeps happening.
        </p>
        {error.digest && (
          <p className="mt-2 text-xs font-mono text-[var(--color-ink-soft)] opacity-70">
            Error ref: {error.digest}
          </p>
        )}
        <div className="mt-7 flex flex-wrap gap-3 justify-center">
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center justify-center px-7 py-3.5 rounded-full bg-[var(--color-coral)] hover:bg-[var(--color-coral-dark)] text-white font-medium"
          >
            Try again
          </button>
          <Link
            href="/"
            className="inline-flex items-center justify-center px-7 py-3.5 rounded-full bg-white border border-[var(--color-brand-blue)] text-[var(--color-brand-blue)] hover:bg-[var(--color-brand-blue)] hover:text-white font-medium"
          >
            Home
          </Link>
        </div>
        <p className="mt-6 text-sm text-[var(--color-ink-soft)]">
          Or call{' '}
          <a
            href={siteConfig.contact.phoneHref}
            className="text-[var(--color-brand-blue)] hover:text-[var(--color-brand-blue-dark)] underline-offset-4 hover:underline"
          >
            {siteConfig.contact.phone}
          </a>
          .
        </p>
      </div>
    </main>
  );
}

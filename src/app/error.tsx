'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { buttonClasses } from '@/components/ui/Button';
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
    <main className="flex min-h-screen items-center bg-[var(--color-paper)] px-5 sm:px-8">
      <div className="mx-auto w-full max-w-[1240px]">
        <h1 className="max-w-3xl text-display text-[2.6rem] sm:text-6xl">
          That wasn&rsquo;t supposed to happen.
        </h1>
        <p className="mt-6 max-w-xl text-lg text-[var(--color-ink-soft)]">
          Something broke on our end and it&rsquo;s been logged. Try again in a
          moment, or call{' '}
          <a href={siteConfig.contact.phoneHref} className="font-medium text-[var(--color-ink)] underline underline-offset-2">
            {siteConfig.contact.phone}
          </a>{' '}
          if it keeps happening.
        </p>
        {error.digest && (
          <p className="mt-3 font-mono text-xs text-[var(--color-ink-soft)]">Error ref: {error.digest}</p>
        )}
        <div className="mt-10 flex flex-wrap gap-3">
          <button type="button" onClick={reset} className={buttonClasses({ size: 'lg' })}>
            Try again
          </button>
          <Link href="/" className={buttonClasses({ size: 'lg', variant: 'outline' })}>
            Home
          </Link>
        </div>
      </div>
    </main>
  );
}

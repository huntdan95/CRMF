'use client';

import { useEffect } from 'react';
import { buttonClasses } from '@/components/ui/Button';
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
    <div className="mx-auto max-w-2xl px-5 py-20 sm:px-8">
      <h1 className="text-display text-[2.25rem]">Something went wrong.</h1>
      <p className="mt-4 text-lg text-[var(--color-ink-soft)]">
        If you already paid, your booking is safe and your confirmation email
        is on its way. Otherwise, try again, or call Travis at{' '}
        <a href={siteConfig.contact.phoneHref} className="font-medium text-[var(--color-ink)] underline underline-offset-2">
          {siteConfig.contact.phone}
        </a>{' '}
        and he&rsquo;ll book you over the phone.
      </p>
      {error.digest && (
        <p className="mt-3 font-mono text-xs text-[var(--color-ink-soft)]">Error ref: {error.digest}</p>
      )}
      <button type="button" onClick={reset} className={buttonClasses({ size: 'lg', className: 'mt-8' })}>
        Try again
      </button>
    </div>
  );
}

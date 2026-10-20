import type { Metadata } from 'next';
import { Suspense } from 'react';
import { BookingFlow } from '@/components/booking/BookingFlow';
import { siteConfig } from '@/lib/site-config';
import { fetchSiteSettings } from '@/lib/settings-server';
import { wetsuitSizesFrom } from '@/lib/site-settings';

export const metadata: Metadata = {
  title: 'Book a Manatee Tour',
  description:
    'Live availability for every Crystal River Manatee Fun departure. Pick a date, choose shared or private, and pay securely online.',
  alternates: { canonical: `${siteConfig.url}/book` },
  robots: { index: false, follow: true },
};

// The wetsuit sizes come from Admin → Settings; a change shows up within a minute.
export const revalidate = 60;

/**
 * The whole booking flow lives on this one URL. State is in the query
 * string — ?date=YYYY-MM-DD&tour=<slug>&guests=N&type=<kind>&step=details —
 * so back/forward, refresh, and shared links all land where you were.
 */
export default async function BookPage() {
  const wetsuitSizes = wetsuitSizesFrom(await fetchSiteSettings());
  return (
    <Suspense fallback={<BookingSkeleton />}>
      <BookingFlow wetsuitSizes={wetsuitSizes} />
    </Suspense>
  );
}

function BookingSkeleton() {
  return (
    <div className="mx-auto max-w-[1240px] px-5 pb-20 pt-10 sm:px-8" aria-busy="true">
      <div className="h-8 w-64 rounded-full bg-[var(--color-sand)]/70" />
      <div className="mt-10 h-14 w-80 max-w-full rounded-lg bg-[var(--color-sand)]/70" />
      <div className="mt-8 grid gap-6 lg:grid-cols-[420px_minmax(0,1fr)]">
        <div className="h-[520px] rounded-2xl bg-white" />
        <div className="h-[520px] rounded-2xl bg-white/60" />
      </div>
    </div>
  );
}

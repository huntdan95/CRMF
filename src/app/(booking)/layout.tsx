import type { ReactNode } from 'react';
import Link from 'next/link';
import { Footer } from '@/components/marketing/Footer';
import { siteConfig } from '@/lib/site-config';

/**
 * Booking layout — minimal header (focus on completing the booking), full
 * marketing footer at the bottom, no mobile bottom bar (the form's Continue
 * button is the only CTA we want visible).
 */
export default function BookingLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <header className="sticky top-0 z-40 bg-[var(--color-cream)]/95 backdrop-blur border-b border-[var(--color-ink)]/8">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-4">
          <Link
            href="/"
            className="font-display text-lg text-[var(--color-brand-blue)] font-semibold leading-tight tracking-tight"
            aria-label={`${siteConfig.name} home`}
          >
            <span className="block">Crystal River</span>
            <span className="block text-[var(--color-coral)] -mt-1 text-sm">
              Manatee Fun
            </span>
          </Link>
          <a
            href={siteConfig.contact.phoneHref}
            className="text-sm font-medium text-[var(--color-brand-blue)] hover:text-[var(--color-brand-blue-dark)]"
          >
            <span className="hidden sm:inline">Questions? </span>
            {siteConfig.contact.phone}
          </a>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <Footer />
    </>
  );
}

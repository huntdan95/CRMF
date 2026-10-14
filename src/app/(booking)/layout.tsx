import type { ReactNode } from 'react';
import Link from 'next/link';
import { Logo } from '@/components/marketing/Logo';
import { Phone } from '@/components/ui/icons';
import { BookingFooterSpacer } from '@/components/booking/BookingFooterSpacer';
import { siteConfig } from '@/lib/site-config';
import { TourCatalogProvider } from '@/components/TourCatalog';
import { fetchTourCatalog } from '@/lib/tours-server';

// Prices, tour names and Active switches come from Admin → Tours.
export const revalidate = 60;

/**
 * Booking layout: a quiet header and footer so the only thing on screen
 * is the booking itself. The phone number stays one tap away.
 */
export default async function BookingLayout({ children }: { children: ReactNode }) {
  const catalog = await fetchTourCatalog();
  return (
    <TourCatalogProvider catalog={catalog}>
      <header className="sticky top-0 z-40 border-b border-[var(--color-sand)] bg-[var(--color-paper)]/92 backdrop-blur-md">
        <div className="mx-auto flex h-[4.25rem] max-w-[1240px] items-center justify-between gap-4 px-5 sm:px-8">
          <Link href="/" aria-label={`${siteConfig.name} home`} className="rounded-md">
            <Logo />
          </Link>
          <a
            href={siteConfig.contact.phoneHref}
            className="inline-flex items-center gap-2 rounded-md text-sm font-medium tabular-nums text-[var(--color-ink)] hover:text-[var(--color-spring)]"
          >
            <Phone size={16} />
            <span className="hidden sm:inline text-[var(--color-ink-soft)]">Questions?</span>
            {siteConfig.contact.phone}
          </a>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-[var(--color-sand)]">
        <div className="mx-auto flex max-w-[1240px] flex-col gap-3 px-5 py-8 text-sm text-[var(--color-ink-soft)] sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <p>
            &copy; {new Date().getFullYear()} {siteConfig.legal.businessName} ·{' '}
            {siteConfig.marina.name}, {siteConfig.marina.city}, {siteConfig.marina.region}
          </p>
          <nav aria-label="Policies" className="flex flex-wrap gap-x-5 gap-y-1">
            <Link href="/cancellation-policy" className="hover:text-[var(--color-ink)]">Cancellation policy</Link>
            <Link href="/faq" className="hover:text-[var(--color-ink)]">FAQ</Link>
            <Link href="/privacy" className="hover:text-[var(--color-ink)]">Privacy</Link>
            <Link href="/terms" className="hover:text-[var(--color-ink)]">Terms</Link>
          </nav>
        </div>
      </footer>
      <BookingFooterSpacer />
    </TourCatalogProvider>
  );
}

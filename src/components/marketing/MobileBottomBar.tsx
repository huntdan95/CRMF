import Link from 'next/link';
import { siteConfig } from '@/lib/site-config';

export function MobileBottomBar() {
  return (
    <div
      className="lg:hidden fixed bottom-0 inset-x-0 z-30 bg-[var(--color-cream)]/95 backdrop-blur border-t border-[var(--color-ink)]/8 shadow-[0_-4px_16px_-4px_rgba(0,0,0,0.08)]"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="flex gap-2 px-3 py-2">
        <a
          href={siteConfig.contact.phoneHref}
          className="flex-1 inline-flex items-center justify-center gap-2 py-3 rounded-full bg-white text-[var(--color-brand-blue)] border border-[var(--color-brand-blue)] font-medium text-sm"
          aria-label={`Call ${siteConfig.contact.phone}`}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d="M22 16.92v3a2 2 0 0 1-2.18 2A19.86 19.86 0 0 1 2.08 4.18 2 2 0 0 1 4.08 2h3a2 2 0 0 1 2 1.72c.12.86.32 1.7.6 2.5a2 2 0 0 1-.45 2.11L8.09 9.41a16 16 0 0 0 6.5 6.5l1.08-1.14a2 2 0 0 1 2.11-.45c.8.28 1.64.48 2.5.6A2 2 0 0 1 22 16.92Z"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinejoin="round"
            />
          </svg>
          Call
        </a>
        <Link
          href="/book"
          className="flex-[1.4] inline-flex items-center justify-center py-3 rounded-full bg-[var(--color-coral)] hover:bg-[var(--color-coral-dark)] text-white font-semibold text-sm shadow-[var(--shadow-card)]"
        >
          Book a tour
        </Link>
      </div>
    </div>
  );
}

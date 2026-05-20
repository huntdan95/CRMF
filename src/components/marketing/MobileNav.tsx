'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { siteConfig } from '@/lib/site-config';

interface Props {
  links: ReadonlyArray<{ href: string; label: string }>;
}

export function MobileNav({ links }: Props) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Close the drawer whenever the user navigates.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Lock body scroll while the drawer is open.
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = '';
      };
    }
  }, [open]);

  return (
    <>
      <button
        type="button"
        aria-label={open ? 'Close menu' : 'Open menu'}
        aria-expanded={open}
        aria-controls="mobile-nav-drawer"
        onClick={() => setOpen((v) => !v)}
        className="lg:hidden inline-flex items-center justify-center w-10 h-10 rounded-full text-[var(--color-brand-blue)] hover:bg-[var(--color-brand-blue)]/10"
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
          {open ? (
            <path
              d="M6 6l12 12M18 6L6 18"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          ) : (
            <>
              <path d="M4 7h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <path d="M4 12h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <path d="M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </>
          )}
        </svg>
      </button>

      {open && (
        <div
          id="mobile-nav-drawer"
          className="lg:hidden fixed inset-0 z-50 bg-[var(--color-ink)]/40 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <div
            className="absolute right-0 top-0 h-full w-[88%] max-w-sm bg-[var(--color-cream)] shadow-2xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Site menu"
          >
            <div className="flex justify-end p-4">
              <button
                type="button"
                aria-label="Close menu"
                onClick={() => setOpen(false)}
                className="inline-flex items-center justify-center w-10 h-10 rounded-full text-[var(--color-ink)] hover:bg-[var(--color-ink)]/10"
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path
                    d="M6 6l12 12M18 6L6 18"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </div>
            <nav className="flex flex-col px-2 pb-6 gap-1" aria-label="Mobile primary">
              {links.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="px-4 py-3 rounded-2xl font-display text-2xl text-[var(--color-ink)] hover:bg-[var(--color-brand-blue)]/10"
                >
                  {link.label}
                </Link>
              ))}
            </nav>
            <div className="mt-auto p-4 border-t border-[var(--color-ink)]/8 space-y-2">
              <a
                href={siteConfig.contact.phoneHref}
                className="block text-center py-3 rounded-full bg-white text-[var(--color-brand-blue)] border border-[var(--color-brand-blue)] font-medium"
              >
                Call {siteConfig.contact.phone}
              </a>
              <Link
                href="/book"
                className="block text-center py-3 rounded-full bg-[var(--color-coral)] hover:bg-[var(--color-coral-dark)] text-white font-medium"
              >
                Book Now
              </Link>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

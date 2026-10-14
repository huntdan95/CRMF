'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { usePathname } from 'next/navigation';
import { Logo } from './Logo';
import { buttonClasses } from '@/components/ui/Button';
import { ArrowRight, Close, Menu, Phone } from '@/components/ui/icons';
import { siteConfig } from '@/lib/site-config';
import { clsx } from '@/lib/clsx';

interface Props {
  links: ReadonlyArray<{ href: string; label: string }>;
  /** White icon for the transparent header over the home hero. */
  invert?: boolean;
}

export function MobileNav({ links, invert = false }: Props) {
  const pathname = usePathname();
  // The page the sheet was opened on. Any navigation away (including the
  // phone's Back button, which skips the links' onClick) closes it.
  const [openedOn, setOpenedOn] = useState<string | null>(null);
  // Forget it once we've left that page, or coming back to it later (a
  // Forward, a Home link) would reopen the menu by itself.
  if (openedOn !== null && openedOn !== pathname) setOpenedOn(null);
  const open = openedOn === pathname;
  const setOpen = (next: boolean) => setOpenedOn(next ? pathname : null);
  const openRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);

  // Lock scroll, move focus in, close on Escape; hand focus back to the
  // menu button when the sheet closes.
  useEffect(() => {
    if (!open) return;
    const opener = openRef.current;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenedOn(null);
    };
    // The sheet is hidden at lg and up. Rotating a tablet past that width
    // would otherwise leave the page scroll-locked behind an invisible menu.
    const desktop = window.matchMedia('(min-width: 64rem)');
    const onResize = (e: MediaQueryListEvent) => {
      if (e.matches) setOpenedOn(null);
    };
    window.addEventListener('keydown', onKey);
    desktop.addEventListener('change', onResize);
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', onKey);
      desktop.removeEventListener('change', onResize);
      opener?.focus();
    };
  }, [open]);

  // Keep Tab inside the sheet while it's open.
  function trapFocus(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'Tab' || !sheetRef.current) return;
    const focusable = sheetRef.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled])');
    if (focusable.length === 0) return;
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  const close = () => setOpen(false);

  const sheet = (
    <div
      ref={sheetRef}
      id="mobile-nav-sheet"
      role="dialog"
      aria-modal="true"
      aria-label="Site menu"
      onKeyDown={trapFocus}
      className="lg:hidden fixed inset-0 z-50 flex flex-col bg-[var(--color-spring-deep)] text-white"
    >
      <div className="flex h-[4.25rem] shrink-0 items-center justify-between px-5">
        <Link href="/" aria-label={`${siteConfig.name} home`} onClick={close}>
          <Logo tone="light" />
        </Link>
        <button
          ref={closeRef}
          type="button"
          aria-label="Close menu"
          onClick={close}
          className="inline-flex h-10 w-10 items-center justify-center rounded-md hover:bg-white/10"
        >
          <Close size={24} />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-5 pt-6" aria-label="Mobile primary">
        <ul className="divide-y divide-white/10 border-y border-white/10">
          {[{ href: '/', label: 'Home' }, ...links].map((link) => {
            const active = pathname === link.href;
            return (
              <li key={link.href}>
                <Link
                  href={link.href}
                  onClick={close}
                  aria-current={active ? 'page' : undefined}
                  className="flex items-center justify-between py-4 text-display text-[1.75rem]"
                >
                  <span className={active ? 'text-[var(--color-spring-bright)]' : undefined}>
                    {link.label}
                  </span>
                  <ArrowRight size={20} className="text-white/40" />
                </Link>
              </li>
            );
          })}
        </ul>
        <ul className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm text-white/75">
          <li><Link href="/reviews" onClick={close}>Reviews</Link></li>
          <li><Link href="/news" onClick={close}>News</Link></li>
          <li><Link href="/cancellation-policy" onClick={close}>Cancellation policy</Link></li>
        </ul>
      </nav>

      <div
        className="grid shrink-0 grid-cols-2 gap-3 border-t border-white/10 p-5"
        style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }}
      >
        <a href={siteConfig.contact.phoneHref} className={buttonClasses({ variant: 'glass', size: 'lg' })}>
          <Phone size={18} />
          Call
        </a>
        <Link href="/book" onClick={close} className={buttonClasses({ size: 'lg' })}>
          Book a tour
        </Link>
      </div>
    </div>
  );

  return (
    <>
      <button
        ref={openRef}
        type="button"
        aria-label="Open menu"
        aria-expanded={open}
        aria-controls="mobile-nav-sheet"
        onClick={() => setOpen(true)}
        className={clsx(
          'lg:hidden inline-flex h-10 w-10 items-center justify-center rounded-md transition-colors',
          invert ? 'text-white hover:bg-white/15' : 'text-[var(--color-ink)] hover:bg-[var(--color-sand)]',
        )}
      >
        <Menu size={24} />
      </button>

      {/* Rendered at the end of <body>: the header's backdrop blur would
          otherwise become the containing block for this fixed sheet and
          squash it to the header's height. Only mounts after a tap, so
          document always exists. */}
      {open && createPortal(sheet, document.body)}
    </>
  );
}

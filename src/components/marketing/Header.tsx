'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Logo } from './Logo';
import { MobileNav } from './MobileNav';
import { buttonClasses } from '@/components/ui/Button';
import { Phone } from '@/components/ui/icons';
import { siteConfig } from '@/lib/site-config';
import { clsx } from '@/lib/clsx';

export const navLinks = [
  { href: '/tours', label: 'Tours' },
  { href: '/about', label: 'About' },
  { href: '/gallery', label: 'Gallery' },
  { href: '/faq', label: 'FAQ' },
  { href: '/contact', label: 'Contact' },
] as const;

/**
 * Sticky site header. On the home page it starts transparent over the hero
 * photo and turns solid once you scroll; everywhere else it's solid.
 */
export function Header() {
  const pathname = usePathname();
  const overHero = pathname === '/';
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    if (!overHero) return;
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [overHero]);

  const transparent = overHero && !scrolled;

  return (
    <header
      className={clsx(
        'top-0 inset-x-0 z-40 transition-[background-color,box-shadow,color] duration-300',
        overHero ? 'fixed' : 'sticky',
        transparent
          ? 'bg-transparent text-white'
          : 'bg-[var(--color-paper)]/92 text-[var(--color-ink)] backdrop-blur-md shadow-[0_1px_0_var(--color-sand)]',
      )}
    >
      {transparent && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-b from-black/45 to-transparent"
        />
      )}
      <div className="mx-auto flex h-[4.25rem] max-w-[1240px] items-center justify-between gap-6 px-5 sm:px-8">
        <Link href="/" aria-label={`${siteConfig.name} home`} className="shrink-0 rounded-md">
          <Logo tone={transparent ? 'light' : 'dark'} />
        </Link>

        <nav className="hidden lg:flex items-center gap-1" aria-label="Primary">
          {navLinks.map((link) => {
            const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? 'page' : undefined}
                className={clsx(
                  'relative rounded-md px-3.5 py-2 text-[0.9375rem] font-medium transition-colors',
                  transparent ? 'text-white/85 hover:text-white' : 'text-[var(--color-ink-soft)] hover:text-[var(--color-ink)]',
                  active && (transparent ? 'text-white' : 'text-[var(--color-ink)]'),
                )}
              >
                {link.label}
                {active && (
                  <span
                    aria-hidden
                    className="absolute inset-x-3.5 -bottom-[3px] h-[2px] rounded-full bg-[var(--color-buoy)]"
                  />
                )}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-2 sm:gap-3">
          <a
            href={siteConfig.contact.phoneHref}
            className={clsx(
              'hidden md:inline-flex items-center gap-2 rounded-md px-2 py-2 text-[0.9375rem] font-medium tabular-nums transition-colors',
              transparent ? 'text-white/90 hover:text-white' : 'text-[var(--color-ink)] hover:text-[var(--color-spring)]',
            )}
          >
            <Phone size={16} />
            {siteConfig.contact.phone}
          </a>
          {/* max-sm:hidden, not "hidden sm:inline-flex": the button's own
              inline-flex comes later in the stylesheet and would beat a plain
              hidden, leaving it on phones and pushing the menu off-screen. */}
          <Link href="/book" className={buttonClasses({ size: 'sm', className: 'max-sm:hidden' })}>
            Book a tour
          </Link>
          <MobileNav links={navLinks} invert={transparent} />
        </div>
      </div>
    </header>
  );
}

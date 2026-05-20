import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { MobileNav } from './MobileNav';
import { siteConfig } from '@/lib/site-config';

const navLinks = [
  { href: '/tours', label: 'Tours' },
  { href: '/about', label: 'About' },
  { href: '/gallery', label: 'Gallery' },
  { href: '/faq', label: 'FAQ' },
  { href: '/contact', label: 'Contact' },
];

export function Header() {
  return (
    <header className="sticky top-0 z-40 bg-[var(--color-cream)]/95 backdrop-blur border-b border-[var(--color-ink)]/8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex items-center justify-between gap-4">
        <Link
          href="/"
          className="font-display text-lg sm:text-xl text-[var(--color-brand-blue)] font-semibold leading-tight tracking-tight shrink-0"
          aria-label={`${siteConfig.name} home`}
        >
          <span className="block">Crystal River</span>
          <span className="block text-[var(--color-coral)] -mt-1">Manatee Fun</span>
        </Link>

        <nav className="hidden lg:flex items-center gap-1" aria-label="Primary">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="px-3 py-2 text-sm font-medium text-[var(--color-ink-soft)] hover:text-[var(--color-brand-blue)] rounded-full transition-colors"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <a
            href={siteConfig.contact.phoneHref}
            className="hidden md:inline-flex text-sm font-medium text-[var(--color-brand-blue)] hover:text-[var(--color-brand-blue-dark)]"
          >
            {siteConfig.contact.phone}
          </a>
          <Button href="/book" size="sm" className="hidden sm:inline-flex">
            Book Now
          </Button>
          <MobileNav links={navLinks} />
        </div>
      </div>
    </header>
  );
}

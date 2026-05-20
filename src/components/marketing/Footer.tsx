import Link from 'next/link';
import { siteConfig } from '@/lib/site-config';

const navColumns = [
  {
    heading: 'Tours',
    links: [
      { href: '/tours', label: 'All tours' },
      { href: '/tours/morning-shared', label: 'Morning shared' },
      { href: '/tours/early-afternoon-shared', label: 'Early afternoon shared' },
      { href: '/tours/whole-day-private', label: 'Whole day private' },
    ],
  },
  {
    heading: 'Plan your trip',
    links: [
      { href: '/about#area', label: 'About Crystal River' },
      { href: '/about#manners', label: 'Manatee manners' },
      { href: '/faq', label: 'FAQ' },
      { href: '/gallery', label: 'Gallery' },
      { href: '/reviews', label: 'Reviews' },
    ],
  },
  {
    heading: 'Crystal River Manatee Fun',
    links: [
      { href: '/about#captain', label: 'Capt. Travis' },
      { href: '/contact', label: 'Contact' },
      { href: '/book', label: 'Book a tour' },
    ],
  },
];

export function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="mt-24 bg-[var(--color-brand-blue)] text-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 lg:py-16">
        <div className="grid gap-10 md:grid-cols-12">
          <div className="md:col-span-4">
            <p className="font-display text-2xl leading-tight">
              <span className="block">Crystal River</span>
              <span className="block text-[var(--color-cream)]">Manatee Fun</span>
            </p>
            <p className="mt-4 text-sm/relaxed text-white/85 max-w-sm">
              Small-group, family-friendly snorkel-with-manatee tours
              from Pete&rsquo;s Pier Marina, captained by Travis Urbin.
            </p>
            <div className="mt-6 space-y-1 text-sm">
              <p className="font-medium">{siteConfig.marina.name}</p>
              <p className="text-white/85">
                {siteConfig.marina.streetAddress}
                <br />
                {siteConfig.marina.city}, {siteConfig.marina.region}{' '}
                {siteConfig.marina.postalCode}
              </p>
              <p className="pt-2">
                <a
                  href={siteConfig.contact.phoneHref}
                  className="hover:text-[var(--color-coral)] underline-offset-4 hover:underline"
                >
                  {siteConfig.contact.phone}
                </a>
              </p>
            </div>
            <div className="mt-6 flex items-center gap-3">
              <a
                href={siteConfig.captain.instagram}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Instagram"
                className="w-10 h-10 inline-flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 transition-colors"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <rect x="3" y="3" width="18" height="18" rx="5" stroke="currentColor" strokeWidth="2" />
                  <circle cx="12" cy="12" r="3.5" stroke="currentColor" strokeWidth="2" />
                  <circle cx="17.5" cy="6.5" r="1" fill="currentColor" />
                </svg>
              </a>
              <a
                href={siteConfig.captain.facebook}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Facebook"
                className="w-10 h-10 inline-flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 transition-colors"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path
                    d="M14 8h2V5h-2a3 3 0 0 0-3 3v2H9v3h2v7h3v-7h2.4L17 10h-3V8.5c0-.3.2-.5.5-.5H14Z"
                    fill="currentColor"
                  />
                </svg>
              </a>
            </div>
          </div>

          <nav className="md:col-span-8 grid grid-cols-2 md:grid-cols-3 gap-8" aria-label="Footer">
            {navColumns.map((col) => (
              <div key={col.heading}>
                <h3 className="text-sm font-semibold uppercase tracking-wider text-[var(--color-cream)]">
                  {col.heading}
                </h3>
                <ul className="mt-3 space-y-2 text-sm">
                  {col.links.map((link) => (
                    <li key={link.href}>
                      <Link
                        href={link.href}
                        className="text-white/85 hover:text-white transition-colors"
                      >
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>

        <div className="mt-12 pt-6 border-t border-white/10 flex flex-col sm:flex-row gap-2 items-start sm:items-center justify-between text-xs text-white/70">
          <p>
            &copy; {year} {siteConfig.legal.businessName}. All rights reserved.
          </p>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>
              Operated by {siteConfig.legal.licensee}, USCG-licensed captain.
              Manatee viewing follows USFWS guidelines.
            </span>
            <Link
              href="/admin/login"
              className="text-white/50 hover:text-white/90 underline-offset-4 hover:underline"
            >
              Admin
            </Link>
          </p>
        </div>
      </div>
    </footer>
  );
}

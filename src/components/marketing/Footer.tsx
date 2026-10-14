import Link from 'next/link';
import { Logo } from './Logo';
import { Facebook, Instagram, MapPin, Phone } from '@/components/ui/icons';
import { siteConfig, publicContactEmail } from '@/lib/site-config';

const navColumns = [
  {
    heading: 'Tours',
    links: [
      { href: '/tours', label: 'All tours & times' },
      { href: '/tours/morning-shared', label: 'Morning, shared' },
      { href: '/tours/mid-morning-private', label: 'Private boat' },
      { href: '/tours/whole-day-private', label: 'Whole-day charter' },
      { href: '/book', label: 'Check availability' },
    ],
  },
  {
    heading: 'Plan your trip',
    links: [
      { href: '/about#manners', label: 'Manatee manners' },
      { href: '/about#area', label: 'Crystal River guide' },
      { href: '/faq', label: 'FAQ' },
      { href: '/gallery', label: 'Gallery' },
      { href: '/news', label: 'News' },
    ],
  },
  {
    heading: 'Company',
    links: [
      { href: '/about#captain', label: 'Capt. Travis' },
      { href: '/reviews', label: 'Reviews' },
      { href: '/contact', label: 'Contact' },
      { href: '/cancellation-policy', label: 'Cancellation policy' },
    ],
  },
];

export function Footer() {
  const year = new Date().getFullYear();
  const email = publicContactEmail();
  return (
    <footer className="bg-[var(--color-ink)] text-white">
      <div className="mx-auto max-w-[1240px] px-5 sm:px-8 pt-16 pb-10 lg:pt-20">
        <div className="grid gap-12 lg:grid-cols-12">
          <div className="lg:col-span-4">
            <Logo tone="light" />
            <p className="mt-5 max-w-sm text-[0.9375rem] leading-relaxed text-white/65">
              Small-group manatee snorkel tours on Kings Bay, run by
              Capt. Travis Urbin from {siteConfig.marina.name}.
            </p>

            <ul className="mt-7 space-y-3 text-[0.9375rem]">
              <li>
                <a
                  href={siteConfig.marina.mapUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group inline-flex gap-3 text-white/85 hover:text-white"
                >
                  <MapPin size={18} className="mt-0.5 shrink-0 text-[var(--color-spring-bright)]" />
                  <span>
                    {siteConfig.marina.name}
                    <br />
                    <span className="text-white/60 group-hover:text-white/80">
                      {siteConfig.marina.streetAddress}, {siteConfig.marina.city},{' '}
                      {siteConfig.marina.region} {siteConfig.marina.postalCode}
                    </span>
                  </span>
                </a>
              </li>
              <li>
                <a
                  href={siteConfig.contact.phoneHref}
                  className="inline-flex items-center gap-3 tabular-nums text-white/85 hover:text-white"
                >
                  <Phone size={18} className="shrink-0 text-[var(--color-spring-bright)]" />
                  {siteConfig.contact.phone}
                </a>
              </li>
              {email && (
                <li>
                  <a href={`mailto:${email}`} className="pl-[30px] text-white/85 hover:text-white">
                    {email}
                  </a>
                </li>
              )}
            </ul>
          </div>

          <nav className="grid grid-cols-2 gap-10 sm:grid-cols-3 lg:col-span-8 lg:pl-12" aria-label="Footer">
            {navColumns.map((col) => (
              <div key={col.heading}>
                <h2 className="text-label text-white/45">{col.heading}</h2>
                <ul className="mt-4 space-y-2.5 text-[0.9375rem]">
                  {col.links.map((link) => (
                    <li key={link.href}>
                      <Link href={link.href} className="text-white/80 transition-colors hover:text-white">
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>

        <div className="mt-16 flex flex-col gap-6 border-t border-white/10 pt-8 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <a
              href={siteConfig.captain.instagram}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Instagram"
              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/15 text-white/80 transition-colors hover:border-white/40 hover:text-white"
            >
              <Instagram size={18} />
            </a>
            <a
              href={siteConfig.captain.facebook}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Facebook"
              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/15 text-white/80 transition-colors hover:border-white/40 hover:text-white"
            >
              <Facebook size={18} />
            </a>
          </div>
          <div className="flex flex-col gap-2 text-xs text-white/45 sm:items-end">
            <div className="flex flex-wrap gap-x-5 gap-y-1">
              <Link href="/privacy" className="hover:text-white">Privacy</Link>
              <Link href="/terms" className="hover:text-white">Terms</Link>
              <Link href="/admin/login" className="hover:text-white">Admin</Link>
            </div>
            <p>
              &copy; {year} {siteConfig.legal.businessName}. Operated by{' '}
              {siteConfig.legal.licensee}, USCG-licensed captain. Manatee viewing
              follows USFWS guidelines.
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}

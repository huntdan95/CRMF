'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { adminSignOut } from '@/lib/firebase/auth-client';
import { clsx } from '@/lib/clsx';
import type { AdminUser } from '@/lib/firebase/auth-server';

const links = [
  { href: '/admin', label: 'Calendar' },
  { href: '/admin/bookings', label: 'Bookings' },
  { href: '/admin/blackouts', label: 'Blackouts' },
  { href: '/admin/tours', label: 'Tours' },
  { href: '/admin/photos', label: 'Photos' },
  { href: '/admin/reports', label: 'Reports' },
  { href: '/admin/settings', label: 'Settings' },
];

interface Props {
  user: AdminUser;
}

export function AdminSidebar({ user }: Props) {
  const pathname = usePathname() ?? '/admin';
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  function isActive(href: string): boolean {
    if (href === '/admin') return pathname === '/admin';
    return pathname.startsWith(href);
  }

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await adminSignOut();
      router.replace('/admin/login');
      router.refresh();
    } catch {
      setSigningOut(false);
    }
  }

  return (
    <>
      {/* Mobile header bar */}
      <div className="lg:hidden flex items-center justify-between bg-white border-b border-[var(--color-ink)]/10 px-4 py-3 sticky top-0 z-30">
        <Link href="/admin" className="font-display text-lg text-[var(--color-brand-blue)]">
          CRMF admin
        </Link>
        <button
          type="button"
          onClick={() => setMobileOpen((v) => !v)}
          aria-label="Toggle navigation"
          aria-expanded={mobileOpen}
          className="w-10 h-10 inline-flex items-center justify-center rounded-full text-[var(--color-brand-blue)] hover:bg-[var(--color-brand-blue)]/10"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
            {mobileOpen ? (
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            ) : (
              <>
                <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </>
            )}
          </svg>
        </button>
      </div>

      <aside
        className={clsx(
          'lg:flex lg:flex-col lg:w-64 lg:min-h-screen lg:border-r lg:border-[var(--color-ink)]/10 lg:bg-white lg:sticky lg:top-0',
          'lg:py-6 lg:px-4',
          mobileOpen
            ? 'block bg-white border-b border-[var(--color-ink)]/10 px-4 py-4'
            : 'hidden lg:flex',
        )}
      >
        <Link
          href="/admin"
          className="hidden lg:block font-display text-xl text-[var(--color-brand-blue)] mb-6"
        >
          Crystal River Manatee Fun
          <span className="block text-xs text-[var(--color-ink-soft)] uppercase tracking-widest mt-0.5">
            Admin
          </span>
        </Link>

        <nav className="flex flex-col gap-1" aria-label="Admin navigation">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setMobileOpen(false)}
              className={clsx(
                'px-3 py-2 rounded-xl text-sm font-medium',
                isActive(link.href)
                  ? 'bg-[var(--color-brand-blue)] text-white'
                  : 'text-[var(--color-ink)] hover:bg-[var(--color-ink)]/5',
              )}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="mt-auto pt-6 lg:pt-8">
          <div className="rounded-2xl bg-[var(--color-cream)] p-3 mb-3">
            <p className="text-xs text-[var(--color-ink-soft)] uppercase tracking-widest">
              Signed in
            </p>
            <p className="text-sm font-medium truncate" title={user.email}>
              {user.name ?? user.email}
            </p>
            {user.name && (
              <p className="text-xs text-[var(--color-ink-soft)] truncate" title={user.email}>
                {user.email}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={handleSignOut}
            disabled={signingOut}
            className="w-full inline-flex items-center justify-center px-3 py-2 rounded-xl text-sm font-medium border border-[var(--color-ink)]/15 text-[var(--color-ink)] hover:bg-[var(--color-ink)]/5 disabled:opacity-60"
          >
            {signingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      </aside>
    </>
  );
}

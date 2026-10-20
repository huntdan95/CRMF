'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { adminSignOut } from '@/lib/firebase/auth-client';
import { clsx } from '@/lib/clsx';
import type { AdminUser } from '@/lib/firebase/auth-server';
import { Logo } from '@/components/marketing/Logo';

const links: Array<{ href: string; label: string; section?: 'main' | 'inbox' | 'content' | 'admin' }> = [
  { href: '/admin', label: 'Dashboard', section: 'main' },
  { href: '/admin/bookings', label: 'Bookings', section: 'main' },
  { href: '/admin/waivers', label: 'Waivers', section: 'main' },
  // Inbox
  { href: '/admin/messages', label: 'Messages', section: 'inbox' },
  { href: '/admin/reschedules', label: 'Reschedule requests', section: 'inbox' },
  // Content
  { href: '/admin/blackouts', label: 'Close a day', section: 'content' },
  { href: '/admin/tours', label: 'Tours', section: 'content' },
  { href: '/admin/photos', label: 'Photos', section: 'content' },
  { href: '/admin/reviews', label: 'Reviews', section: 'content' },
  { href: '/admin/blog', label: 'Blog', section: 'content' },
  // Reference / settings
  { href: '/admin/reports', label: 'Reports', section: 'admin' },
  { href: '/admin/activity', label: 'Activity log', section: 'admin' },
  { href: '/admin/crew', label: 'Crew', section: 'admin' },
  { href: '/admin/settings', label: 'Settings', section: 'admin' },
];

const SECTION_LABELS: Record<string, string> = {
  main: '',
  inbox: 'Inbox',
  content: 'Content',
  admin: 'Reports & settings',
};

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
      <div className="lg:hidden flex items-center justify-between bg-[var(--color-spring-deep)] text-white px-4 py-3 sticky top-0 z-30">
        <Link href="/admin" aria-label="Admin dashboard">
          <Logo tone="light" />
        </Link>
        <button
          type="button"
          onClick={() => setMobileOpen((v) => !v)}
          aria-label="Toggle navigation"
          aria-expanded={mobileOpen}
          className="w-10 h-10 inline-flex items-center justify-center rounded-lg text-white hover:bg-white/10"
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
          'lg:flex lg:flex-col lg:w-64 lg:h-screen lg:overflow-y-auto lg:bg-[var(--color-spring-deep)] lg:text-white lg:sticky lg:top-0',
          'lg:py-6 lg:px-4',
          mobileOpen
            ? 'block bg-[var(--color-spring-deep)] text-white px-4 py-4'
            : 'hidden lg:flex',
        )}
      >
        <Link href="/admin" aria-label="Admin dashboard" className="hidden lg:block mb-8 px-1">
          <Logo tone="light" />
          <span className="mt-3 block text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-white/60">
            Admin
          </span>
        </Link>

        <nav className="flex flex-col gap-1" aria-label="Admin navigation">
          {links.map((link, i) => {
            const prevSection = i > 0 ? links[i - 1]!.section : undefined;
            const showHeader =
              link.section &&
              link.section !== 'main' &&
              link.section !== prevSection;
            return (
              <div key={link.href}>
                {showHeader && (
                  <p className="px-3 mt-4 mb-1 text-[10px] uppercase tracking-[0.18em] text-white/60 font-semibold">
                    {SECTION_LABELS[link.section!]}
                  </p>
                )}
                <Link
                  href={link.href}
                  onClick={() => setMobileOpen(false)}
                  aria-current={isActive(link.href) ? 'page' : undefined}
                  className={clsx(
                    'relative px-3 py-2 rounded-lg text-sm font-medium block transition-colors',
                    isActive(link.href)
                      ? 'bg-white/12 text-white before:absolute before:left-0 before:top-2 before:bottom-2 before:w-[3px] before:rounded-full before:bg-[var(--color-buoy)]'
                      : 'text-white/75 hover:bg-white/8 hover:text-white',
                  )}
                >
                  {link.label}
                </Link>
              </div>
            );
          })}
        </nav>

        <div className="mt-auto pt-6 lg:pt-8">
          <div className="rounded-xl border border-white/12 p-3 mb-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/60">
              Signed in
            </p>
            <p className="mt-1 text-sm font-medium truncate" title={user.email}>
              {user.name ?? user.email}
            </p>
            {user.name && (
              <p className="text-xs text-white/60 truncate" title={user.email}>
                {user.email}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={handleSignOut}
            disabled={signingOut}
            className="w-full inline-flex items-center justify-center px-3 py-2 rounded-lg text-sm font-medium border border-white/20 text-white hover:bg-white/10 disabled:opacity-60"
          >
            {signingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      </aside>
    </>
  );
}

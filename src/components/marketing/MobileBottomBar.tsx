'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { buttonClasses } from '@/components/ui/Button';
import { Phone } from '@/components/ui/icons';
import { siteConfig } from '@/lib/site-config';
import { clsx } from '@/lib/clsx';

/**
 * Phone-width only: call and book, always one thumb away. On the home page
 * it waits until the hero (which has its own booking bar) scrolls away.
 */
export function MobileBottomBar() {
  const pathname = usePathname();
  const onHome = pathname === '/';
  const [pastHero, setPastHero] = useState(false);

  useEffect(() => {
    if (!onHome) return;
    const onScroll = () => setPastHero(window.scrollY > window.innerHeight * 0.75);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [onHome]);

  const hidden = onHome && !pastHero;

  return (
    <div
      aria-hidden={hidden || undefined}
      className={clsx(
        'lg:hidden fixed bottom-0 inset-x-0 z-30 border-t border-[var(--color-sand)] bg-[var(--color-paper)]/95 backdrop-blur-md transition-transform duration-300',
        hidden && 'translate-y-full',
      )}
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="flex gap-2.5 px-4 py-3">
        <a
          href={siteConfig.contact.phoneHref}
          aria-label={`Call ${siteConfig.contact.phone}`}
          tabIndex={hidden ? -1 : undefined}
          className={buttonClasses({ variant: 'outline', size: 'md', className: 'flex-1 bg-white' })}
        >
          <Phone size={17} />
          Call
        </a>
        <Link
          href="/book"
          tabIndex={hidden ? -1 : undefined}
          className={buttonClasses({ size: 'md', className: 'flex-[1.6]' })}
        >
          Check availability
        </Link>
      </div>
    </div>
  );
}

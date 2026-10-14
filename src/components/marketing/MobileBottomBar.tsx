import Link from 'next/link';
import { buttonClasses } from '@/components/ui/Button';
import { Phone } from '@/components/ui/icons';
import { siteConfig } from '@/lib/site-config';

/** Phone-width only: call and book, always one thumb away. */
export function MobileBottomBar() {
  return (
    <div
      className="lg:hidden fixed bottom-0 inset-x-0 z-30 border-t border-[var(--color-sand)] bg-[var(--color-paper)]/95 backdrop-blur-md"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="flex gap-2.5 px-4 py-3">
        <a
          href={siteConfig.contact.phoneHref}
          aria-label={`Call ${siteConfig.contact.phone}`}
          className={buttonClasses({ variant: 'outline', size: 'md', className: 'flex-1 bg-white' })}
        >
          <Phone size={17} />
          Call
        </a>
        <Link href="/book" className={buttonClasses({ size: 'md', className: 'flex-[1.6]' })}>
          Check availability
        </Link>
      </div>
    </div>
  );
}

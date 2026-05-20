import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { siteConfig } from '@/lib/site-config';

export default function NotFound() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-[var(--color-cream)] px-4">
      <div className="max-w-md text-center">
        <p className="text-sm font-medium uppercase tracking-widest text-[var(--color-coral-dark)]">
          404
        </p>
        <h1 className="mt-2 font-display text-4xl sm:text-5xl leading-tight">
          The springs don&rsquo;t go that way.
        </h1>
        <p className="mt-4 text-[var(--color-ink-soft)]">
          We couldn&rsquo;t find that page. Try one of these instead, or call
          us and we&rsquo;ll get you sorted.
        </p>
        <div className="mt-7 flex flex-wrap gap-3 justify-center">
          <Button href="/" size="md">
            Home
          </Button>
          <Button href="/tours" variant="secondary" size="md">
            See tours
          </Button>
        </div>
        <p className="mt-6 text-sm text-[var(--color-ink-soft)]">
          <a
            href={siteConfig.contact.phoneHref}
            className="text-[var(--color-brand-blue)] hover:text-[var(--color-brand-blue-dark)] underline-offset-4 hover:underline"
          >
            Or call {siteConfig.contact.phone}
          </a>
        </p>
      </div>
    </main>
  );
}

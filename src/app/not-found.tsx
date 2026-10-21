import type { Metadata } from 'next';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { Logo } from '@/components/marketing/Logo';
import { ArrowRight, Phone } from '@/components/ui/icons';
import { siteConfig } from '@/lib/site-config';

// Its own tab title: without one it takes the home page's.
export const metadata: Metadata = {
  title: 'Page not found',
};

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col bg-[var(--color-spring-deep)] px-5 text-white sm:px-8">
      <div className="mx-auto w-full max-w-[1240px] py-6">
        <Link href="/" aria-label={`${siteConfig.name} home`}>
          <Logo tone="light" />
        </Link>
      </div>
      <div className="mx-auto flex w-full max-w-[1240px] flex-1 flex-col justify-center pb-24">
        <p className="text-label text-[var(--color-spring-bright)]">Page not found</p>
        <h1 className="mt-5 max-w-3xl text-display text-[2.8rem] sm:text-7xl">
          The springs don&rsquo;t go that way.
        </h1>
        <p className="mt-6 max-w-xl text-lg text-white/75">
          That page isn&rsquo;t here. It may have moved when the site was rebuilt.
          These will get you back on course.
        </p>
        <div className="mt-10 flex flex-wrap gap-3">
          <Button href="/book" size="lg">
            Check availability
            <ArrowRight size={18} />
          </Button>
          <Button href="/tours" size="lg" variant="glass">
            Tours and prices
          </Button>
          <Button href="/" size="lg" variant="glass">
            Home
          </Button>
        </div>
        <a
          href={siteConfig.contact.phoneHref}
          className="mt-10 inline-flex items-center gap-2 text-white/75 hover:text-white"
        >
          <Phone size={18} />
          Or call {siteConfig.contact.phone}
        </a>
      </div>
    </main>
  );
}

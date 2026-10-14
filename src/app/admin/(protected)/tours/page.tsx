import type { Metadata } from 'next';
import { ToursAdmin } from '@/components/admin/ToursAdmin';
import { RateSeasonsAdmin } from '@/components/admin/RateSeasonsAdmin';

export const metadata: Metadata = {
  title: 'Tours — Admin',
  robots: { index: false, follow: false },
};

export default function ToursAdminPage() {
  return (
    <div className="max-w-4xl mx-auto">
      <header className="mb-6">
        <h1 className="text-display text-[2rem] sm:text-[2.5rem]">Tours &amp; prices</h1>
        <p className="text-[var(--color-ink-soft)] mt-1 text-base">
          Change prices, names, descriptions and what&rsquo;s included, or stop
          taking bookings for a tour. The website and checkout pick up changes
          within a minute. Departure times are fixed; call your developer to
          change those.
        </p>
        <nav aria-label="On this page" className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-base font-medium">
          <a href="#standard-prices" className="text-[var(--color-brand-blue)] hover:underline">
            Standard prices
          </a>
          <a href="#seasonal-rates" className="text-[var(--color-brand-blue)] hover:underline">
            Seasonal &amp; holiday rates
          </a>
        </nav>
      </header>

      <h2 id="standard-prices" className="scroll-mt-20 font-display text-xl mb-3">Standard prices</h2>
      <ToursAdmin />

      <section id="seasonal-rates" className="scroll-mt-20 mt-12">
        <h2 className="font-display text-xl">Seasonal &amp; holiday rates</h2>
        <p className="text-[var(--color-ink-soft)] mt-1 mb-4 text-base">
          Charge different prices for a date range: peak season, a holiday
          weekend, a single day. Guests see the right price for the date they
          pick, and checkout charges it.
        </p>
        <RateSeasonsAdmin />
      </section>
    </div>
  );
}

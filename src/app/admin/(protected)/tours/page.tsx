import type { Metadata } from 'next';
import { ToursAdmin } from '@/components/admin/ToursAdmin';
import { RateSeasonsAdmin } from '@/components/admin/RateSeasonsAdmin';
import { AdminPageHeader, SectionHeading } from '@/components/admin/ui';

export const metadata: Metadata = {
  title: 'Tours — Admin',
  robots: { index: false, follow: false },
};

const jumpLink =
  'inline-flex items-center min-h-9 rounded-full border border-[var(--color-line)] bg-white px-4 text-sm font-semibold text-[var(--color-spring)] hover:border-[var(--color-spring)]';

export default function ToursAdminPage() {
  return (
    <div className="max-w-4xl mx-auto">
      <AdminPageHeader
        title="Tours & prices"
        description={
          <>
            Change prices, names, descriptions and what&rsquo;s included, or stop
            taking bookings for a tour. The website and checkout pick up changes
            within a minute. Departure times are fixed; call your developer to
            change those.
          </>
        }
      >
        <nav aria-label="On this page" className="mt-4 flex flex-wrap gap-2">
          <a href="#standard-prices" className={jumpLink}>
            Standard prices
          </a>
          <a href="#seasonal-rates" className={jumpLink}>
            Seasonal &amp; holiday rates
          </a>
        </nav>
      </AdminPageHeader>

      <SectionHeading id="standard-prices" title="Standard prices" />
      <ToursAdmin />

      <section className="mt-14">
        <SectionHeading
          id="seasonal-rates"
          title="Seasonal & holiday rates"
          description={
            <>
              Charge different prices for a date range: peak season, a holiday
              weekend, a single day. Guests see the right price for the date they
              pick, and checkout charges it.
            </>
          }
        />
        <RateSeasonsAdmin />
      </section>
    </div>
  );
}

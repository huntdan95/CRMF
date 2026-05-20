import type { Metadata } from 'next';
import { TourCard } from '@/components/marketing/TourCard';
import { Section, SectionTitle } from '@/components/marketing/Section';
import { tours } from '@/lib/tours';

export const metadata: Metadata = {
  title: 'All Tours — 2-Hour, 4-Hour & Whole-Day Manatee Trips',
  description:
    'Compare every Crystal River Manatee Fun tour: shared 2-hour tours at $84/person, private boat charters from $500, and full-day private trips at $895.',
  alternates: { canonical: 'https://crystalrivermanateefun.com/tours' },
};

export default function ToursPage() {
  const shared = tours.filter((t) => t.type === 'shared' && t.active);
  const privateTours = tours.filter((t) => t.type === 'private' && t.active);
  return (
    <>
      <Section tone="cream" size="md">
        <SectionTitle
          eyebrow="Tours"
          title="Pick the morning that fits your trip"
          description="Each tour runs from Pete's Pier Marina in Crystal River. Up to six guests per boat, all gear included, USCG-licensed captain on board."
        />
      </Section>

      <Section tone="white" size="md">
        <h2 className="font-display text-2xl sm:text-3xl mb-6">
          Shared tours <span className="text-[var(--color-ink-soft)] text-base font-sans font-normal">— $84/person, up to 6 guests</span>
        </h2>
        <p className="text-[var(--color-ink-soft)] mb-8 max-w-2xl">
          You share the boat with other guests (max six total). Best value for
          couples, solo travelers, and small families.
        </p>
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {shared.map((tour) => (
            <TourCard key={tour.slug} tour={tour} />
          ))}
        </div>
      </Section>

      <Section tone="cream" size="md">
        <h2 className="font-display text-2xl sm:text-3xl mb-6">
          Private tours <span className="text-[var(--color-ink-soft)] text-base font-sans font-normal">— whole boat to your group</span>
        </h2>
        <p className="text-[var(--color-ink-soft)] mb-8 max-w-2xl">
          You and up to five guests get the boat to yourselves. No strangers
          in your photos, set your own pace, choose how long at each spring.
        </p>
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {privateTours.map((tour) => (
            <TourCard key={tour.slug} tour={tour} />
          ))}
        </div>
      </Section>
    </>
  );
}

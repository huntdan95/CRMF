import type { Metadata } from 'next';
import { TourCard } from '@/components/marketing/TourCard';
import { Section } from '@/components/marketing/Section';
import { tours } from '@/lib/tours';
import { siteConfig } from '@/lib/site-config';

export const revalidate = 60;

export const metadata: Metadata = {
  title: 'All Tours — 2-Hour, Whole-Day & Private Manatee Trips',
  description:
    'Nine tour offerings on the Crystal River: shared 2-hour tours at $84/person, private boat charters from $500, and a full-day private at $895.',
  alternates: { canonical: `${siteConfig.url}/tours` },
};

export default function ToursPage() {
  const shared = tours.filter((t) => t.type === 'shared' && t.active);
  const privateTours = tours
    .filter((t) => t.type === 'private' && t.active && t.timeSlot !== 'whole-day');
  const wholeDay = tours.find((t) => t.timeSlot === 'whole-day' && t.active);

  return (
    <>
      {/* Hero header */}
      <section className="bg-[var(--color-cream)] border-b border-[var(--color-ink)]/8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-24">
          <p className="text-xs sm:text-sm font-medium uppercase tracking-[0.3em] text-[var(--color-coral-dark)]">
            All tours
          </p>
          <h1 className="mt-4 font-display text-5xl sm:text-6xl lg:text-7xl leading-[1.02] max-w-3xl">
            Nine ways onto the river.<br />
            <span className="text-[var(--color-ink-soft)]">One captain, six guests.</span>
          </h1>
          <div className="mt-8 flex flex-wrap gap-x-8 gap-y-2 text-sm uppercase tracking-[0.14em] text-[var(--color-ink-soft)] font-medium">
            <span>2-hour tours from $84</span>
            <span aria-hidden className="text-[var(--color-ink)]/20">|</span>
            <span>Private boat from $500</span>
            <span aria-hidden className="text-[var(--color-ink)]/20">|</span>
            <span>Whole-day private $895</span>
          </div>
        </div>
      </section>

      {/* Included strip */}
      <section className="bg-[var(--color-brand-blue)] text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-7 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm sm:text-base font-medium">
          <span className="inline-flex items-center gap-2">
            <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-[var(--color-coral)] text-[10px] font-semibold uppercase tracking-[0.14em]">
              Free
            </span>
            GoPro photos from your tour
          </span>
          <span aria-hidden className="text-white/30">·</span>
          <span className="inline-flex items-center gap-2">
            <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-white text-[var(--color-brand-blue)] text-[10px] font-semibold uppercase tracking-[0.14em]">
              Always
            </span>
            In-water swim guide
          </span>
          <span aria-hidden className="text-white/30">·</span>
          <span>Snorkel gear · wetsuit · water + hot chocolate</span>
        </div>
      </section>

      {/* Shared */}
      <Section tone="white" size="lg">
        <div className="mb-10 flex items-end justify-between gap-4 flex-wrap">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.3em] text-[var(--color-coral-dark)]">
              Shared · $84 / person
            </p>
            <h2 className="mt-3 font-display text-4xl sm:text-5xl leading-[1.05]">
              Share the boat,<br />keep the budget.
            </h2>
          </div>
          <p className="text-sm text-[var(--color-ink-soft)] max-w-xs">
            Up to six guests on the boat total. Best value for couples,
            solo travelers, and small families.
          </p>
        </div>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {shared.map((tour) => (
            <TourCard key={tour.slug} tour={tour} />
          ))}
        </div>
      </Section>

      {/* Private */}
      <Section tone="cream" size="lg">
        <div className="mb-10 flex items-end justify-between gap-4 flex-wrap">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.3em] text-[var(--color-coral-dark)]">
              Private · $500 flat
            </p>
            <h2 className="mt-3 font-display text-4xl sm:text-5xl leading-[1.05]">
              The whole boat,<br />just your crew.
            </h2>
          </div>
          <p className="text-sm text-[var(--color-ink-soft)] max-w-xs">
            You and up to five guests get the boat to yourselves. Set your
            pace, choose your light.
          </p>
        </div>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {privateTours.map((tour) => (
            <TourCard key={tour.slug} tour={tour} />
          ))}
        </div>
      </Section>

      {/* Whole day — full-width hero card */}
      {wholeDay && (
        <Section tone="white" size="lg">
          <p className="text-xs font-medium uppercase tracking-[0.3em] text-[var(--color-coral-dark)]">
            All day · $895 flat
          </p>
          <h2 className="mt-3 font-display text-4xl sm:text-5xl leading-[1.05] mb-10">
            Sunrise to sunset.<br />
            <span className="text-[var(--color-ink-soft)]">
              Every spring, no rush.
            </span>
          </h2>
          <div className="grid lg:grid-cols-3 gap-6">
            <TourCard tour={wholeDay} imageSlot="group" />
            <div className="lg:col-span-2 rounded-2xl bg-[var(--color-cream)] p-8 lg:p-10 flex flex-col justify-center">
              <p className="text-base lg:text-lg leading-relaxed text-[var(--color-ink)] max-w-2xl">
                The full day on the water with your group. We visit every
                spring at its best light, pause for lunch on the river,
                and you go home with the tan and the camera roll.
              </p>
              <ul className="mt-6 grid sm:grid-cols-2 gap-3 text-sm">
                {wholeDay.included.slice(0, 4).map((item) => (
                  <li key={item} className="flex items-start gap-2">
                    <span className="mt-0.5 inline-flex w-5 h-5 shrink-0 items-center justify-center rounded-full bg-[var(--color-brand-blue)] text-white">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden>
                        <path d="M5 12.5l4 4 10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </span>
                    <span className="text-[var(--color-ink-soft)]">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Section>
      )}
    </>
  );
}

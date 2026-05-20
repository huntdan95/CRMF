import type { Metadata } from 'next';
import { Button } from '@/components/ui/Button';
import { PlaceholderImage } from '@/components/marketing/PlaceholderImage';
import { Section, SectionTitle } from '@/components/marketing/Section';
import { siteConfig } from '@/lib/site-config';

export const metadata: Metadata = {
  title: 'About Crystal River — Where to Stay, Eat & Spend the Day',
  description:
    'Crystal River, Florida — home to the only legal swim-with-manatees experience in North America. Where to stay, where to eat, and what to do beyond the springs.',
  alternates: { canonical: `${siteConfig.url}/crystal-river` },
};

const stays = [
  {
    name: 'Plantation on Crystal River',
    note: 'Big resort right on Kings Bay, walking distance to the marina. Pool, restaurant, easy if you have kids.',
  },
  {
    name: 'Days Inn Crystal River',
    note: 'No-frills, clean, walking distance to everything. The best value in town.',
  },
  {
    name: 'Best Western Plus',
    note: 'A few minutes from the marina, free breakfast, good for short trips.',
  },
  {
    name: 'Airbnb on Hunter Spring',
    note: 'A couple of waterfront houses on the Hunter Spring run sleep 4-8 and have their own docks.',
  },
];

const eats = [
  {
    name: 'The Cracker House',
    note: 'Fish sandwich and key lime pie. Locals eat lunch here.',
  },
  {
    name: 'Cattle Dog Coffee Roasters',
    note: 'Pre-tour coffee and a breakfast burrito if you have an early slot.',
  },
  {
    name: "Vito's Italian Restaurant",
    note: 'After-tour dinner. Family-style, big portions, kids welcome.',
  },
  {
    name: 'Crystal River Wine & Cheese',
    note: 'Charcuterie board to take back to the rental, or a glass after the tour.',
  },
];

const dos = [
  {
    name: 'Three Sisters Springs',
    note: 'The big draw beyond manatee tours. Walking boardwalks, gorgeous spring water.',
  },
  {
    name: 'Homosassa Springs Wildlife State Park',
    note: 'About 25 min south. Manatees you can see without getting wet, plus Florida panthers and gators.',
  },
  {
    name: 'Hunter Spring Park',
    note: 'Free, in town. Locals swim here on hot afternoons.',
  },
  {
    name: 'Citrus County Speedway',
    note: 'Saturday-night dirt-track races. Florida at its most Florida.',
  },
];

export default function CrystalRiverPage() {
  return (
    <>
      <Section tone="cream" size="md">
        <div className="grid gap-10 lg:grid-cols-12 items-center">
          <div className="lg:col-span-7">
            <p className="text-sm font-medium uppercase tracking-widest text-[var(--color-coral-dark)]">
              About the area
            </p>
            <h1 className="mt-2 font-display text-4xl sm:text-5xl leading-tight">
              Crystal River, Florida.
            </h1>
            <p className="mt-4 text-base sm:text-lg leading-relaxed text-[var(--color-ink-soft)] max-w-2xl">
              An hour north of Tampa, an hour west of Orlando — and an entirely
              different Florida. No theme parks, no skyline, no rush. Just a
              spring-fed bay where manatees come to keep warm, and a small
              town that&rsquo;s been quietly hosting them for thousands of
              years.
            </p>
            <p className="mt-3 text-base text-[var(--color-ink-soft)] max-w-2xl">
              This page is the cheat-sheet we give friends visiting for the
              first time. Hopefully it makes your trip easier.
            </p>
          </div>
          <div className="lg:col-span-5">
            <PlaceholderImage
              label="Aerial of Crystal River and Kings Bay"
              aspect="square"
            />
          </div>
        </div>
      </Section>

      <Section tone="white" size="md">
        <SectionTitle
          eyebrow="Sleep"
          title="Where to stay"
          description="Within 10 minutes of Pete's Pier Marina — so you can roll out of bed for an early tour."
          align="left"
        />
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {stays.map((s) => (
            <div
              key={s.name}
              className="rounded-2xl bg-[var(--color-cream)] p-5 border border-[var(--color-ink)]/8"
            >
              <h3 className="font-display text-lg">{s.name}</h3>
              <p className="mt-1 text-sm text-[var(--color-ink-soft)] leading-relaxed">
                {s.note}
              </p>
            </div>
          ))}
        </div>
        <p className="mt-4 text-xs text-[var(--color-ink-soft)] opacity-70">
          [TODO: confirm and finalize stay/eat/do lists with the owner.]
        </p>
      </Section>

      <Section tone="cream" size="md">
        <SectionTitle
          eyebrow="Eat"
          title="Where to eat"
          description="Locals' picks for breakfast, lunch, and after-the-tour dinner."
          align="left"
        />
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {eats.map((e) => (
            <div
              key={e.name}
              className="rounded-2xl bg-white p-5 border border-[var(--color-ink)]/8"
            >
              <h3 className="font-display text-lg">{e.name}</h3>
              <p className="mt-1 text-sm text-[var(--color-ink-soft)] leading-relaxed">
                {e.note}
              </p>
            </div>
          ))}
        </div>
      </Section>

      <Section tone="white" size="md">
        <SectionTitle
          eyebrow="Do"
          title="What else to do"
          description="Build a long weekend around your tour."
          align="left"
        />
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {dos.map((d) => (
            <div
              key={d.name}
              className="rounded-2xl bg-[var(--color-cream)] p-5 border border-[var(--color-ink)]/8"
            >
              <h3 className="font-display text-lg">{d.name}</h3>
              <p className="mt-1 text-sm text-[var(--color-ink-soft)] leading-relaxed">
                {d.note}
              </p>
            </div>
          ))}
        </div>
      </Section>

      <Section tone="blue" size="md">
        <div className="text-center max-w-xl mx-auto">
          <h2 className="font-display text-3xl sm:text-4xl text-white leading-tight">
            Ready to plan the trip?
          </h2>
          <p className="mt-4 text-white/85">
            Lock in a tour slot first — those go faster than hotel rooms. We
            can usually find a tour to match whatever travel dates you&rsquo;ve
            already got.
          </p>
          <div className="mt-6">
            <Button href="/book" size="lg">
              See available dates
            </Button>
          </div>
        </div>
      </Section>
    </>
  );
}

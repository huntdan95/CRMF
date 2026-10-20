import type { Metadata } from 'next';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { ResolvedImage, resolveDistinctPhotos } from '@/components/marketing/SiteImage';
import { Container, Section, SectionTitle } from '@/components/marketing/Section';
import { FaqList } from '@/components/marketing/FaqList';
import { ArrowRight, Camera, Check, Cup, Mask, Shield, Swim, Users } from '@/components/ui/icons';
import { pickFaqs } from '@/lib/faq';
import { formatPrice, getTourBySlug, runningStartTimes, slotLabels, slotOrder, type MarketingTour } from '@/lib/tours';
import { marinaNow } from '@/lib/availability';
import {
  formatPriceRange,
  kindPriceRanges,
  upcomingPriceRange,
  type PriceRange,
} from '@/lib/pricing';
import { fetchTourCatalog, type TourCatalog } from '@/lib/tours-server';
import { siteConfig } from '@/lib/site-config';
import { pageSeo } from '@/lib/seo';
import type { SiteImageSlot } from '@/lib/firebase/types';

export const revalidate = 60;

const title = 'Manatee Tours in Crystal River: Shared, Private & Full-Day';

export async function generateMetadata(): Promise<Metadata> {
  const catalog = await fetchTourCatalog();
  const r = kindPriceRanges(catalog.tours, marinaNow().date, catalog.seasons);
  const at = (range: PriceRange) => (range.min === range.max ? 'at ' : 'from ') + formatPrice(range.min);
  const parts = [
    r.shared && `shared 2-hour snorkel tours ${at(r.shared)}/person`,
    r.private && `private boat charters from ${formatPrice(r.private.min)}`,
    r.wholeDay && `a full-day private ${at(r.wholeDay)}`,
  ].filter(Boolean);
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')}, and ${parts.at(-1)}` : parts.join('');
  const description = `Crystal River manatee tours: ${list}. Gear included.`;
  return {
    // Absolute: "Crystal River" is already in it.
    title: { absolute: title },
    description,
    ...pageSeo('/tours', { title, description }),
  };
}

// Schedule only (times); prices and Active switches come from the catalog.
const wholeDay = getTourBySlug('whole-day-private')!;

/** What the cards say that Travis can change in Admin → Tours. */
interface LiveFacts {
  /** Start times of the two-hour departures switched on, per type. */
  times: { shared: string[]; private: string[] };
  /** The dearest private boat costs less than six of the cheapest shared seats. */
  privateUndercutsShared: boolean;
}

const COUNTS = ['no', 'one', 'two', 'three', 'four'];

/** `four departures a day`, `one departure a day`. */
function departuresADay(times: string[]): string {
  return `${COUNTS[times.length] ?? times.length} departure${times.length === 1 ? '' : 's'} a day`;
}

const options: Array<{
  id: 'shared' | 'private' | 'whole-day';
  name: string;
  unit: string;
  lede: string | ((live: LiveFacts) => string);
  points: string[] | ((live: LiveFacts) => string[]);
  slot: SiteImageSlot;
  fallback: SiteImageSlot;
  href: string;
  cta: string;
}> = [
  {
    id: 'shared',
    name: 'Shared boat',
    unit: 'per person',
    lede: 'Book seats and share the boat with a few other guests.',
    points: (live) => [
      `Two hours, ${departuresADay(live.times.shared)}`,
      'Six guests on board at most',
      'Best for couples, solo travelers, small families',
    ],
    slot: 'tour-morning-shared',
    fallback: 'dappled',
    href: '/book?type=shared',
    cta: 'Find shared seats',
  },
  {
    id: 'private',
    name: 'Private boat',
    unit: 'for up to 6',
    lede: ({ times }) =>
      times.private.length === 1
        ? `The whole boat for your group, at ${times.private[0]}.`
        : `The whole boat for your group, at any of the ${COUNTS[times.private.length] ?? times.private.length} times.`,
    points: (live) => [
      'Two hours, just your group',
      'Set the pace and stay longer where you like',
      // Only while it's true, as on the home page: a higher private price or
      // a private rate season can take it past six shared seats.
      ...(live.privateUndercutsShared ? ['Costs less than six shared seats'] : []),
    ],
    slot: 'tour-mid-morning-private',
    fallback: 'pair',
    href: '/book?type=private',
    cta: 'Find a private boat',
  },
  {
    id: 'whole-day',
    name: 'Whole-day charter',
    unit: 'for up to 6',
    lede: `${wholeDay.startTimeDisplay} to ${wholeDay.endTimeDisplay}, private, the whole day on the water.`,
    points: [
      'Every spring on the river that day',
      'A lunch stop of your choice',
      'Needs a day with no other bookings',
    ],
    slot: 'tour-whole-day-private',
    fallback: 'group',
    href: '/book?type=whole-day',
    cta: 'Find an open day',
  },
];

const included = [
  { icon: Swim, title: 'An in-water guide', body: 'Travis is in the water with your group the whole time, not just driving the boat.' },
  { icon: Mask, title: 'All the gear', body: 'Wetsuit, mask, and snorkel. Wetsuits are set aside in the sizes you pick when you book.' },
  { icon: Camera, title: 'GoPro photos', body: 'Travis shoots the highlights underwater and emails you the files. No photo package to buy.' },
  { icon: Cup, title: 'Water and hot chocolate', body: 'On board for the ride back. The springs are 72°F, so the cocoa earns its place.' },
  { icon: Users, title: 'Six guests, tops', body: 'Six is the hard cap on every tour, shared or private.' },
  { icon: Shield, title: 'Weather refunds', body: 'If Travis cancels for lightning or high winds, you get every dollar back.' },
];

const priceFaqs = pickFaqs([
  "What's the difference between a shared and a private tour?",
  'Do children cost the same as adults?',
  "Is it cheaper if I don't get in the water?",
  'Do you take groups bigger than six?',
]);

/** One tour's price for the table: `$84` or `from $84`. */
function tourPrice(t: MarketingTour, catalog: TourCatalog, today: string): string {
  return formatPriceRange(upcomingPriceRange([t], today, catalog.seasons));
}

export default async function ToursPage() {
  const catalog = await fetchTourCatalog();
  const today = marinaNow().date;
  const ranges = kindPriceRanges(catalog.tours, today, catalog.seasons);
  const rangeFor = { shared: ranges.shared, private: ranges.private, 'whole-day': ranges.wholeDay };
  const live: LiveFacts = {
    times: {
      shared: runningStartTimes(catalog.tours, 'shared'),
      private: runningStartTimes(catalog.tours, 'private'),
    },
    privateUndercutsShared:
      !!ranges.private && !!ranges.shared && ranges.private.max < 6 * ranges.shared.min,
  };
  // A kind Travis has switched off entirely drops out.
  const shownOptions = options
    .map((o) => ({
      ...o,
      range: rangeFor[o.id],
      lede: typeof o.lede === 'function' ? o.lede(live) : o.lede,
      points: typeof o.points === 'function' ? o.points(live) : o.points,
    }))
    .filter((o): o is typeof o & { range: PriceRange } => o.range != null);
  const tours = catalog.tours;
  const wholeDayLive = tours.find((t) => t.slug === wholeDay.slug)!;
  // Listed only while Travis has it switched on.
  const sunsetLive = tours.find((t) => t.timeSlot === 'sunset' && t.active);
  // Cards side by side: never the same photo twice.
  const optionPhotos = await resolveDistinctPhotos(
    shownOptions.map((o) => ({ slot: o.slot, fallbackSlot: o.fallback })),
  );
  return (
    <>
      <Section tone="paper" size="md" className="!pb-12">
        <SectionTitle
          as="h1"
          size="lg"
          title="Crystal River manatee tours and prices"
          description="Every tour is on Kings Bay with Capt. Travis, the same boat and the same gear. You choose the time, and who else is on board."
        />
      </Section>

      <Section tone="paper" size="sm" className="!pt-0">
        <div className="grid gap-6 lg:grid-cols-3">
          {shownOptions.map((o, i) => (
            <article
              key={o.id}
              id={o.id}
              className="flex flex-col overflow-hidden rounded-2xl border border-[var(--color-sand)] bg-white"
            >
              <ResolvedImage
                photo={optionPhotos[i]!}
                className="aspect-[16/10]"
                priority={i === 0}
                sizes="(min-width: 1024px) 400px, 100vw"
              />
              <div className="flex flex-1 flex-col p-6 sm:p-8">
                <h2 className="text-2xl font-bold">{o.name}</h2>
                <p className="mt-3 flex items-baseline gap-2">
                  {o.range.min !== o.range.max && <span className="text-[var(--color-ink-soft)]">from</span>}
                  <span className="text-display text-[2.6rem] tabular-nums">{formatPrice(o.range.min)}</span>
                  <span className="text-[var(--color-ink-soft)]">{o.unit}</span>
                </p>
                <p className="mt-3 leading-relaxed text-[var(--color-ink-soft)]">{o.lede}</p>
                <ul className="mt-6 space-y-2.5">
                  {o.points.map((p) => (
                    <li key={p} className="flex items-start gap-2.5 text-[0.9375rem]">
                      <Check size={18} className="mt-0.5 shrink-0 text-[var(--color-spring)]" />
                      {p}
                    </li>
                  ))}
                </ul>
                <div className="mt-auto pt-8">
                  <Button href={o.href} variant={o.id === 'shared' ? 'primary' : 'dark'} className="w-full">
                    {o.cta}
                    <ArrowRight size={18} />
                  </Button>
                </div>
              </div>
            </article>
          ))}
        </div>
      </Section>

      {/* Departure times — links into all nine tour pages. ---------------- */}
      <Section tone="white" size="lg" id="times">
        <div className="grid gap-12 lg:grid-cols-[4fr_7fr] lg:gap-20">
          <SectionTitle
            title="Departure times"
            description={
              <>
                Each two-hour slot runs as shared or private, whichever is
                booked first. Once a shared seat sells, that slot stays shared;
                once someone takes the boat, it&rsquo;s theirs.
              </>
            }
          />
          {/* Below sm each price stacks over its unit, the arrows go and the
              padding tightens, so the table fits a 360px phone. Narrower than
              that it scrolls sideways instead of cutting off the private prices. */}
          <div className="overflow-x-auto rounded-2xl border border-[var(--color-sand)]">
            <table className="w-full text-left">
              <caption className="sr-only">Tour departure times and prices</caption>
              <thead className="bg-[var(--color-paper)] text-label text-[var(--color-ink-soft)]">
                <tr>
                  <th scope="col" className="px-4 py-3 sm:px-6">Departs</th>
                  <th scope="col" className="px-3 py-3">Shared</th>
                  <th scope="col" className="px-3 py-3 pr-4 sm:pr-6">Private</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-sand)]">
                {slotOrder.map((slot) => {
                  const s = tours.find((t) => t.timeSlot === slot && t.type === 'shared')!;
                  const p = tours.find((t) => t.timeSlot === slot && t.type === 'private')!;
                  return (
                    <tr key={slot}>
                      <th scope="row" className="px-4 py-4 font-normal sm:px-6">
                        <span className="block whitespace-nowrap text-display text-[1.35rem] tabular-nums">
                          {s.startTimeDisplay}
                        </span>
                        <span className="text-sm text-[var(--color-ink-soft)]">
                          {slotLabels[slot]} · back {s.endTimeDisplay}
                        </span>
                      </th>
                      <td className="px-3 py-4">
                        {s.active ? (
                          <Link href={`/tours/${s.slug}`} className="group inline-flex flex-col gap-x-1.5 font-semibold hover:text-[var(--color-spring)] sm:flex-row sm:items-center">
                            {tourPrice(s, catalog, today)}
                            <span className="font-normal text-[var(--color-ink-soft)]">a seat</span>
                            <ArrowRight size={15} className="hidden text-[var(--color-ink-soft)] transition-transform group-hover:translate-x-0.5 sm:block" />
                          </Link>
                        ) : (
                          <span className="text-sm text-[var(--color-ink-soft)]">Not running</span>
                        )}
                      </td>
                      <td className="px-3 py-4 pr-4 sm:pr-6">
                        {p.active ? (
                          <Link href={`/tours/${p.slug}`} className="group inline-flex flex-col gap-x-1.5 font-semibold hover:text-[var(--color-spring)] sm:flex-row sm:items-center">
                            {tourPrice(p, catalog, today)}
                            <span className="font-normal text-[var(--color-ink-soft)]">the boat</span>
                            <ArrowRight size={15} className="hidden text-[var(--color-ink-soft)] transition-transform group-hover:translate-x-0.5 sm:block" />
                          </Link>
                        ) : (
                          <span className="text-sm text-[var(--color-ink-soft)]">Not running</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                <tr className="bg-[var(--color-mist)]/50">
                  <th scope="row" className="px-4 py-4 font-normal sm:px-6">
                    <span className="block whitespace-nowrap text-display text-[1.35rem] tabular-nums">
                      {wholeDay.startTimeDisplay}
                    </span>
                    <span className="text-sm text-[var(--color-ink-soft)]">Whole day · back {wholeDay.endTimeDisplay}</span>
                  </th>
                  <td className="px-3 py-4 text-sm text-[var(--color-ink-soft)]">Private only</td>
                  <td className="px-3 py-4 pr-4 sm:pr-6">
                    {wholeDayLive.active ? (
                      <Link href={`/tours/${wholeDay.slug}`} className="group inline-flex items-center gap-1.5 font-semibold hover:text-[var(--color-spring)]">
                        {tourPrice(wholeDayLive, catalog, today)}
                        <ArrowRight size={15} className="hidden text-[var(--color-ink-soft)] transition-transform group-hover:translate-x-0.5 sm:block" />
                      </Link>
                    ) : (
                      <span className="text-sm text-[var(--color-ink-soft)]">Not running</span>
                    )}
                  </td>
                </tr>
                {sunsetLive && (
                  <tr className="bg-[var(--color-mist)]/50">
                    <th scope="row" className="px-4 py-4 font-normal sm:px-6">
                      <span className="block text-display text-[1.35rem]">Before sunset</span>
                      <span className="text-sm text-[var(--color-ink-soft)]">
                        Sunset cruise · 2 hours · April 1 – November 14
                      </span>
                    </th>
                    <td className="px-3 py-4 text-sm text-[var(--color-ink-soft)]">Private only</td>
                    <td className="px-3 py-4 pr-4 sm:pr-6">
                      <Link href={`/tours/${sunsetLive.slug}`} className="group inline-flex items-center gap-1.5 font-semibold hover:text-[var(--color-spring)]">
                        {tourPrice(sunsetLive, catalog, today)}
                        <ArrowRight size={15} className="hidden text-[var(--color-ink-soft)] transition-transform group-hover:translate-x-0.5 sm:block" />
                      </Link>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </Section>

      {/* Included ------------------------------------------------------- */}
      <Section tone="paper" size="lg">
        <SectionTitle title="On every snorkel tour" />
        <div className="mt-12 grid gap-x-10 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
          {included.map(({ icon: Icon, title: t, body }) => (
            <div key={t} className="border-t border-[var(--color-ink)]/12 pt-6">
              <Icon size={26} className="text-[var(--color-spring)]" />
              <h3 className="mt-4 text-lg font-bold">{t}</h3>
              <p className="mt-2 leading-relaxed text-[var(--color-ink-soft)]">{body}</p>
            </div>
          ))}
        </div>
        <p className="mt-12 text-[var(--color-ink-soft)]">
          Wear your swimsuit under clothes suited to the weather, and bring a
          towel and reef-safe sunscreen. That&rsquo;s it.
        </p>
      </Section>

      {/* Price questions -------------------------------------------------- */}
      <Section tone="white" size="lg">
        <div className="grid gap-12 lg:grid-cols-[5fr_7fr] lg:gap-20">
          <SectionTitle
            title="About the prices"
            description={
              <>
                No booking fees. Children are the same price as adults. More on the{' '}
                <Link href="/faq" className="font-medium text-[var(--color-ink)] underline underline-offset-2">
                  FAQ page
                </Link>
                .
              </>
            }
          />
          <FaqList faqs={priceFaqs} />
        </div>
      </Section>

      <section className="bg-[var(--color-spring-deep)] text-white">
        <Container className="flex flex-col gap-8 py-16 sm:py-20 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-display text-[2.2rem] sm:text-5xl">Ready to pick a date?</h2>
            <p className="mt-3 text-lg text-white/75">
              Live seat counts for every departure, up to a year out.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button href="/book" size="lg">
              Check availability
              <ArrowRight size={18} />
            </Button>
            <Button href={siteConfig.contact.phoneHref} size="lg" variant="glass">
              Call {siteConfig.contact.phone}
            </Button>
          </div>
        </Container>
      </section>
    </>
  );
}


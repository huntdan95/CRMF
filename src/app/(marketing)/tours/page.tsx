import type { Metadata } from 'next';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { ResolvedImage, resolveDistinctPhotos } from '@/components/marketing/SiteImage';
import { Container, Section, SectionTitle } from '@/components/marketing/Section';
import { FaqList } from '@/components/marketing/FaqList';
import { ArrowRight, Camera, Check, Cup, Mask, Shield, Swim, Users } from '@/components/ui/icons';
import { pickFaqs } from '@/lib/faq';
import { formatPrice, getTourBySlug, slotLabels, slotOrder, tours } from '@/lib/tours';
import { siteConfig } from '@/lib/site-config';
import { pageSeo } from '@/lib/seo';
import type { SiteImageSlot } from '@/lib/firebase/types';

export const revalidate = 60;

const title = 'All Tours — 2-Hour, Whole-Day & Private Manatee Trips';
const description =
  'Nine tour offerings on the Crystal River: shared 2-hour tours at $84/person, private boat charters from $500, and a full-day private at $895.';

export const metadata: Metadata = {
  title,
  description,
  ...pageSeo('/tours', { title, description }),
};

const shared = getTourBySlug('morning-shared')!;
const priv = getTourBySlug('morning-private')!;
const wholeDay = getTourBySlug('whole-day-private')!;

const options: Array<{
  id: string;
  name: string;
  price: string;
  unit: string;
  lede: string;
  points: string[];
  slot: SiteImageSlot;
  fallback: SiteImageSlot;
  href: string;
  cta: string;
}> = [
  {
    id: 'shared',
    name: 'Shared boat',
    price: formatPrice(shared.pricePerPerson ?? 0),
    unit: 'per person',
    lede: 'Book seats and share the boat with a few other guests.',
    points: [
      'Two hours, four departures a day',
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
    price: formatPrice(priv.flatPrice ?? 0),
    unit: 'for up to 6',
    lede: 'The whole boat for your group, at any of the four times.',
    points: [
      'Two hours, just your group',
      'Set the pace and stay longer where you like',
      'Costs less than six shared seats',
    ],
    slot: 'tour-mid-morning-private',
    fallback: 'pair',
    href: '/book?type=private',
    cta: 'Find a private boat',
  },
  {
    id: 'whole-day',
    name: 'Whole-day charter',
    price: formatPrice(wholeDay.flatPrice ?? 0),
    unit: 'for up to 6',
    lede: `${wholeDay.startTimeDisplay} to ${wholeDay.endTimeDisplay}, private, the whole day on the water.`,
    points: [
      'Every spring on the river that day',
      'Lunch stop wherever you like',
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
  { icon: Mask, title: 'All the gear', body: 'Wetsuit, mask, snorkel, and fins, sized ahead of time from the ages you give us.' },
  { icon: Camera, title: 'GoPro photos', body: 'Travis shoots the highlights underwater and emails you the files. No photo package to buy.' },
  { icon: Cup, title: 'Water and hot chocolate', body: 'On board for the ride back. The springs are 72°F, so the cocoa earns its place.' },
  { icon: Users, title: 'Six guests, tops', body: 'Six is the cap on every tour, so Travis can keep an eye on everyone in the water.' },
  { icon: Shield, title: 'Weather refunds', body: 'If Travis cancels for lightning or high winds, you get every dollar back.' },
];

const priceFaqs = pickFaqs([
  "What's the difference between a shared and a private tour?",
  'Do children cost the same as adults?',
  "Is it cheaper if I don't get in the water?",
  'Do you take groups bigger than six?',
]);

export default async function ToursPage() {
  // Three cards side by side: never the same photo twice.
  const optionPhotos = await resolveDistinctPhotos(
    options.map((o) => ({ slot: o.slot, fallbackSlot: o.fallback })),
  );
  return (
    <>
      <Section tone="paper" size="md" className="!pb-12">
        <SectionTitle
          as="h1"
          size="lg"
          title="Tours and prices"
          description="Every tour is on Kings Bay with Capt. Travis, the same boat and the same gear. You choose the time, and who else is on board."
        />
      </Section>

      <Section tone="paper" size="sm" className="!pt-0">
        <div className="grid gap-6 lg:grid-cols-3">
          {options.map((o, i) => (
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
                  <span className="text-display text-[2.6rem] tabular-nums">{o.price}</span>
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
          <div className="overflow-hidden rounded-2xl border border-[var(--color-sand)]">
            <table className="w-full text-left">
              <caption className="sr-only">Tour departure times and prices</caption>
              <thead className="bg-[var(--color-paper)] text-label text-[var(--color-ink-soft)]">
                <tr>
                  <th scope="col" className="px-5 py-3 sm:px-6">Departs</th>
                  <th scope="col" className="px-3 py-3">Shared</th>
                  <th scope="col" className="px-3 py-3 pr-5 sm:pr-6">Private</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-sand)]">
                {slotOrder.map((slot) => {
                  const s = tours.find((t) => t.timeSlot === slot && t.type === 'shared')!;
                  const p = tours.find((t) => t.timeSlot === slot && t.type === 'private')!;
                  return (
                    <tr key={slot}>
                      <th scope="row" className="px-5 py-4 font-normal sm:px-6">
                        <span className="block whitespace-nowrap text-display text-[1.35rem] tabular-nums">
                          {s.startTimeDisplay}
                        </span>
                        <span className="text-sm text-[var(--color-ink-soft)]">
                          {slotLabels[slot]} · back {s.endTimeDisplay}
                        </span>
                      </th>
                      <td className="px-3 py-4">
                        <Link href={`/tours/${s.slug}`} className="group inline-flex items-center gap-1.5 font-semibold hover:text-[var(--color-spring)]">
                          {formatPrice(s.pricePerPerson ?? 0)}
                          <span className="font-normal text-[var(--color-ink-soft)]">a seat</span>
                          <ArrowRight size={15} className="text-[var(--color-ink-soft)] transition-transform group-hover:translate-x-0.5" />
                        </Link>
                      </td>
                      <td className="px-3 py-4 pr-5 sm:pr-6">
                        <Link href={`/tours/${p.slug}`} className="group inline-flex items-center gap-1.5 font-semibold hover:text-[var(--color-spring)]">
                          {formatPrice(p.flatPrice ?? 0)}
                          <span className="font-normal text-[var(--color-ink-soft)]">the boat</span>
                          <ArrowRight size={15} className="text-[var(--color-ink-soft)] transition-transform group-hover:translate-x-0.5" />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
                <tr className="bg-[var(--color-mist)]/50">
                  <th scope="row" className="px-5 py-4 font-normal sm:px-6">
                    <span className="block whitespace-nowrap text-display text-[1.35rem] tabular-nums">
                      {wholeDay.startTimeDisplay}
                    </span>
                    <span className="text-sm text-[var(--color-ink-soft)]">Whole day · back {wholeDay.endTimeDisplay}</span>
                  </th>
                  <td className="px-3 py-4 text-sm text-[var(--color-ink-soft)]">Private only</td>
                  <td className="px-3 py-4 pr-5 sm:pr-6">
                    <Link href={`/tours/${wholeDay.slug}`} className="group inline-flex items-center gap-1.5 font-semibold hover:text-[var(--color-spring)]">
                      {formatPrice(wholeDay.flatPrice ?? 0)}
                      <ArrowRight size={15} className="text-[var(--color-ink-soft)] transition-transform group-hover:translate-x-0.5" />
                    </Link>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </Section>

      {/* Included ------------------------------------------------------- */}
      <Section tone="paper" size="lg">
        <SectionTitle title="On every tour" />
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
          Bring a swimsuit, a towel, and reef-safe sunscreen. That&rsquo;s it.
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


import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { ResolvedImage, SiteImage, resolveDistinctPhotos } from '@/components/marketing/SiteImage';
import { Container, Section, SectionTitle } from '@/components/marketing/Section';
import { FaqList } from '@/components/marketing/FaqList';
import { HeroBooking } from '@/components/home/HeroBooking';
import { DeparturesBoard } from '@/components/home/DeparturesBoard';
import { ArrowRight, Check, MapPin, Phone, Star } from '@/components/ui/icons';
import { upcomingDepartures } from '@/lib/availability-server';
import { bookingHref } from '@/lib/availability';
import { pickFaqs } from '@/lib/faq';
import { tourSteps } from '@/lib/experience';
import { photos } from '@/lib/photos';
import { formatPrice, getTourBySlug, slotOrder, tours } from '@/lib/tours';
import { fetchPublishedTestimonials } from '@/lib/testimonials-server';
import { siteConfig } from '@/lib/site-config';
import { localBusinessJsonLd, pageSeo } from '@/lib/seo';
import type { SiteImageSlot } from '@/lib/firebase/types';

export const revalidate = 60;

export const metadata: Metadata = {
  ...pageSeo('/', {
    title: 'Crystal River Manatee Tours | Swim with Manatees with Capt. Travis',
    description:
      "Shared and private manatee snorkel tours from Pete's Pier Marina in Crystal River, FL. Six guests max, with USCG-licensed Capt. Travis in the water with you.",
  }),
};

const morningShared = getTourBySlug('morning-shared')!;
const morningPrivate = getTourBySlug('morning-private')!;
const wholeDay = getTourBySlug('whole-day-private')!;
const departTimes = slotOrder.map((s) => tours.find((t) => t.timeSlot === s)!.startTimeDisplay);


const boats: Array<{
  name: string;
  price: string;
  unit: string;
  body: string;
  times: string;
  slot: SiteImageSlot;
  fallback: SiteImageSlot;
  href: string;
  note?: string;
}> = [
  {
    name: 'Shared boat',
    price: formatPrice(morningShared.pricePerPerson ?? 0),
    unit: 'a person',
    body: 'Book seats and share the boat with a few other guests, never more than six in all. The best value for couples, solo travelers, and small families.',
    times: departTimes.join(' · '),
    slot: 'tour-morning-shared',
    fallback: 'dappled',
    href: '/book?type=shared',
  },
  {
    name: 'Private boat',
    price: formatPrice(morningPrivate.flatPrice ?? 0),
    unit: 'your group, up to 6',
    body: 'The whole boat for your family or friends. Your pace, your stops, and no strangers in the photos.',
    times: departTimes.join(' · '),
    slot: 'tour-mid-morning-private',
    fallback: 'pair',
    href: '/book?type=private',
    note: `For six people it costs less than six shared seats.`,
  },
  {
    name: 'Whole-day charter',
    price: formatPrice(wholeDay.flatPrice ?? 0),
    unit: 'your group, up to 6',
    body: 'Seven to three on the water: every spring on the river that day, with a lunch stop wherever you like.',
    times: `${wholeDay.startTimeDisplay} – ${wholeDay.endTimeDisplay}`,
    slot: 'tour-whole-day-private',
    fallback: 'group',
    href: '/book?type=whole-day',
  },
];

const credentials = [
  'USCG-licensed Master Captain',
  'USFWS-trained manatee guide',
  'CPR and first-aid certified',
];

const rules = [
  'Float at the surface and let them come to you',
  'No touching, chasing, or cornering',
  'No diving down on a resting manatee',
  'Cameras welcome, flash off',
];

const homeFaqs = pickFaqs([
  'Will we definitely see manatees?',
  'What should I bring?',
  'Do I need to know how to swim?',
  'How cold is the water?',
  'Is there an age limit?',
  'What if the weather is bad?',
]);

export default async function HomePage() {
  const [departures, reviews, boatPhotos] = await Promise.all([
    upcomingDepartures({ limit: 6 }),
    fetchPublishedTestimonials(),
    // Three cards side by side: never the same photo twice.
    resolveDistinctPhotos(boats.map((b) => ({ slot: b.slot, fallbackSlot: b.fallback }))),
  ]);
  const featuredReviews = [
    ...reviews.filter((r) => r.featured),
    ...reviews.filter((r) => !r.featured),
  ].slice(0, 3);

  return (
    <>
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(localBusinessJsonLd()) }}
      />

      {/* Hero ------------------------------------------------------------ */}
      <section className="relative isolate flex min-h-[100svh] flex-col justify-end overflow-hidden bg-[var(--color-spring-deep)] text-white lg:min-h-[min(100svh,960px)]">
        <SiteImage
          slot="hero"
          aspect="auto"
          className="absolute inset-0 -z-20 h-full"
          imgClassName="animate-settle object-[50%_35%]"
          priority
          sizes="100vw"
        />
        <div aria-hidden className="absolute inset-0 -z-10 bg-gradient-to-t from-[#06201d] via-[#06201d]/40 to-[#06201d]/10" />
        <div aria-hidden className="absolute inset-0 -z-10 bg-gradient-to-r from-[#06201d]/70 via-[#06201d]/10 to-transparent" />

        <Container className="pb-10 pt-28 sm:pb-14">
          <div className="max-w-[54rem]">
            <p className="text-label text-white/75">Kings Bay · Crystal River, Florida</p>
            <h1 className="mt-5 text-display text-[3.1rem] sm:text-7xl lg:text-[6.5rem]">
              Swim with wild manatees.
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-white/85 sm:text-xl">
              Two-hour snorkel tours with Capt. Travis Urbin. Six guests at
              most, and he&rsquo;s in the water with you the whole time.
            </p>
          </div>
          <div className="max-w-[54rem]">
            <HeroBooking />
          </div>
          <ul className="mt-8 flex flex-wrap gap-x-7 gap-y-2 text-sm text-white/80">
            <li>From {formatPrice(morningShared.pricePerPerson ?? 0)} a person</li>
            <li>Wetsuit and snorkel gear included</li>
            <li>Free GoPro photos</li>
            <li>Leaves from {siteConfig.marina.name}</li>
          </ul>
        </Container>
      </section>

      {/* Next departures ------------------------------------------------- */}
      <Section tone="paper" size="md">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <SectionTitle
            title={departures?.length ? 'Next departures' : 'Four departures a day'}
            description={
              departures?.length
                ? 'Straight from the booking calendar. Tap one to book it.'
                : 'Every two-hour slot runs as a shared or a private tour. Pick one to see open dates.'
            }
          />
          <Link
            href="/book"
            className="inline-flex shrink-0 items-center gap-2 font-semibold text-[var(--color-spring)] hover:text-[var(--color-ink)]"
          >
            See every date
            <ArrowRight size={18} />
          </Link>
        </div>
        <div className="mt-10">
          <DeparturesBoard departures={departures} />
        </div>
        <p className="mt-5 text-sm text-[var(--color-ink-soft)]">
          Also: the{' '}
          <Link href={bookingHref(wholeDay)} className="font-medium text-[var(--color-ink)] underline underline-offset-2">
            whole-day private charter
          </Link>
          , {wholeDay.startTimeDisplay} to {wholeDay.endTimeDisplay}, {formatPrice(wholeDay.flatPrice ?? 0)}.
          Same-day seats and groups over six:{' '}
          <a href={siteConfig.contact.phoneHref} className="font-medium text-[var(--color-ink)] underline underline-offset-2">
            call {siteConfig.contact.phone}
          </a>
          .
        </p>
      </Section>

      {/* The two hours --------------------------------------------------- */}
      <Section tone="white" size="lg">
        <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-20">
          <div className="relative aspect-[4/5] overflow-hidden rounded-2xl sm:aspect-[4/3] lg:aspect-[4/5]">
            <Image
              src={photos.snorkelGroup.src}
              alt={photos.snorkelGroup.alt}
              fill
              placeholder="blur"
              sizes="(min-width: 1024px) 560px, 100vw"
              className="object-cover"
            />
          </div>
          <div>
            <SectionTitle
              title="How the two hours go"
              description="No experience needed. Most first-timers are comfortable within a few minutes."
            />
            <ol className="mt-10 space-y-8">
              {tourSteps.map((s, i) => (
                <li key={s.title} className="grid grid-cols-[2.75rem_1fr] gap-4">
                  <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-[var(--color-mist)] text-display text-lg text-[var(--color-spring)] tabular-nums">
                    {i + 1}
                  </span>
                  <div className="pt-1.5">
                    <h3 className="text-lg font-bold">{s.title}</h3>
                    <p className="mt-1.5 leading-relaxed text-[var(--color-ink-soft)]">{s.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </Section>

      {/* Choose your boat ------------------------------------------------ */}
      <Section tone="paper" size="lg">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <SectionTitle
            title="Share the boat, or take all of it"
            description="Same captain, same springs, same gear on every tour. The only question is who else is on board."
          />
          <Link
            href="/tours"
            className="inline-flex shrink-0 items-center gap-2 font-semibold text-[var(--color-spring)] hover:text-[var(--color-ink)]"
          >
            Compare all tours
            <ArrowRight size={18} />
          </Link>
        </div>
        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {boats.map((b, i) => (
            <Link
              key={b.name}
              href={b.href}
              className="group flex flex-col overflow-hidden rounded-2xl border border-[var(--color-sand)] bg-white transition-shadow hover:shadow-[var(--shadow-lift)]"
            >
              <ResolvedImage
                photo={boatPhotos[i]!}
                className="aspect-[4/3]"
                imgClassName="transition-transform duration-700 ease-out group-hover:scale-[1.04]"
                sizes="(min-width: 768px) 400px, 100vw"
              />
              <div className="flex flex-1 flex-col p-6 sm:p-7">
                <div className="flex items-baseline justify-between gap-4">
                  <h3 className="text-xl font-bold">{b.name}</h3>
                  <p className="text-right">
                    <span className="text-display text-[1.75rem] tabular-nums">{b.price}</span>
                  </p>
                </div>
                <p className="text-right text-sm text-[var(--color-ink-soft)]">{b.unit}</p>
                <p className="mt-4 leading-relaxed text-[var(--color-ink-soft)]">{b.body}</p>
                {b.note && (
                  <p className="mt-3 text-sm font-medium text-[var(--color-spring)]">{b.note}</p>
                )}
                <div className="mt-auto flex items-center justify-between gap-4 border-t border-[var(--color-sand)] pt-5 mt-6">
                  <p className="text-sm tabular-nums text-[var(--color-ink-soft)]">{b.times}</p>
                  <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--color-ink)] text-white transition-colors group-hover:bg-[var(--color-buoy)] group-hover:text-[var(--color-ink)]">
                    <ArrowRight size={18} />
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
        <p className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 text-[0.9375rem] text-[var(--color-ink-soft)]">
          <span className="font-semibold text-[var(--color-ink)]">Every tour includes</span>
          {['Wetsuit, mask, snorkel, fins', 'Travis in the water with you', 'GoPro photos', 'Water and hot chocolate'].map((x) => (
            <span key={x} className="inline-flex items-center gap-1.5">
              <Check size={16} className="text-[var(--color-spring)]" />
              {x}
            </span>
          ))}
        </p>
      </Section>

      {/* Captain --------------------------------------------------------- */}
      <section className="bg-[var(--color-spring-deep)] text-white">
        <div className="mx-auto grid max-w-[1240px] items-center gap-12 px-5 py-20 sm:px-8 sm:py-28 lg:grid-cols-[5fr_6fr] lg:gap-20">
          <SiteImage
            slot="about-captain"
            fallbackSlot="greeting"
            aspect="portrait"
            rounded="2xl"
            imgClassName="object-[62%_50%]"
            sizes="(min-width: 1024px) 500px, 100vw"
          />
          <div>
            <p className="text-label text-[var(--color-spring-bright)]">Your captain</p>
            <h2 className="mt-4 text-display text-[2.4rem] sm:text-6xl">Travis Urbin</h2>
            <div className="mt-7 space-y-5 text-lg leading-relaxed text-white/80">
              <p>
                Travis has spent eleven years on the Crystal River, fishing the
                flats and snorkeling the springs, learning where the manatees
                settle as the water and the seasons change.
              </p>
              <p>
                He kept his boat to six guests and runs every trip himself. The
                person who answers the phone is the one who meets you at the
                dock, and the one in the water next to your kids.
              </p>
            </div>
            <ul className="mt-8 grid gap-3 sm:grid-cols-3">
              {credentials.map((c) => (
                <li key={c} className="rounded-xl border border-white/15 px-4 py-3 text-sm font-medium">
                  {c}
                </li>
              ))}
            </ul>
            <div className="mt-9">
              <Button href="/about#captain" variant="light">
                More about Travis
                <ArrowRight size={18} />
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Reviews (only when there are some) ------------------------------ */}
      {featuredReviews.length > 0 && (
        <Section tone="white" size="lg">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
            <SectionTitle title="From people who’ve been out with Travis" />
            <Link
              href="/reviews"
              className="inline-flex shrink-0 items-center gap-2 font-semibold text-[var(--color-spring)] hover:text-[var(--color-ink)]"
            >
              All reviews
              <ArrowRight size={18} />
            </Link>
          </div>
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {featuredReviews.map((r) => (
              <figure key={r.id} className="flex flex-col rounded-2xl bg-[var(--color-paper)] p-7">
                {r.rating && (
                  <p className="flex gap-0.5 text-[var(--color-buoy)]" aria-label={`${r.rating} out of 5 stars`}>
                    {Array.from({ length: r.rating }, (_, i) => (
                      <Star key={i} size={16} />
                    ))}
                  </p>
                )}
                <blockquote className="mt-4 flex-1 text-lg leading-relaxed">&ldquo;{r.quote}&rdquo;</blockquote>
                <figcaption className="mt-6 text-sm">
                  <span className="font-semibold">{r.author}</span>
                  {r.location && <span className="text-[var(--color-ink-soft)]"> · {r.location}</span>}
                </figcaption>
              </figure>
            ))}
          </div>
        </Section>
      )}

      {/* Manatee manners ------------------------------------------------- */}
      <section className="relative isolate overflow-hidden bg-[var(--color-ink)] text-white">
        <div className="mx-auto grid max-w-[1240px] lg:grid-cols-2">
          <div className="px-5 py-20 sm:px-8 sm:py-28 lg:pr-16">
            <h2 className="text-display text-[2.4rem] sm:text-6xl">The manatees set the distance.</h2>
            <p className="mt-7 max-w-xl text-lg leading-relaxed text-white/75">
              Manatees are federally protected, and Citrus County is the only
              place in the U.S. where you can legally swim with them. Every guest
              watches the three-minute U.S. Fish &amp; Wildlife video and agrees to
              the rules when they book. When a curious one swims over to you,
              that&rsquo;s its choice to make.
            </p>
            <ul className="mt-9 space-y-3.5">
              {rules.map((r) => (
                <li key={r} className="flex items-start gap-3 text-[1.0625rem]">
                  <Check size={20} className="mt-0.5 shrink-0 text-[var(--color-spring-bright)]" />
                  {r}
                </li>
              ))}
            </ul>
            <div className="mt-10">
              <Button href="/about#manners" variant="glass">
                Watch the video
                <ArrowRight size={18} />
              </Button>
            </div>
          </div>
          <div className="relative min-h-[360px] lg:min-h-full">
            <SiteImage
              slot="manners-callout"
              fallbackSlot="pair"
              aspect="auto"
              className="absolute inset-0 h-full"
              sizes="(min-width: 1024px) 620px, 100vw"
            />
          </div>
        </div>
      </section>

      {/* FAQ --------------------------------------------------------------- */}
      <Section tone="paper" size="lg">
        <div className="grid gap-12 lg:grid-cols-[5fr_7fr] lg:gap-20">
          <div>
            <SectionTitle
              title="Good questions"
              description={
                <>
                  The ones we hear most. The rest are on the{' '}
                  <Link href="/faq" className="font-medium text-[var(--color-ink)] underline underline-offset-2">
                    FAQ page
                  </Link>
                  , or call Travis. He picks up when he isn&rsquo;t on the water.
                </>
              }
            />
            <a
              href={siteConfig.contact.phoneHref}
              className="mt-8 inline-flex items-center gap-3 text-display text-[1.6rem] tabular-nums hover:text-[var(--color-spring)]"
            >
              <Phone size={22} />
              {siteConfig.contact.phone}
            </a>
          </div>
          <FaqList faqs={homeFaqs} />
        </div>
      </Section>

      {/* Closing --------------------------------------------------------- */}
      <section className="relative isolate overflow-hidden bg-[var(--color-spring-deep)] text-white">
        <Image
          src={photos.grazing.src}
          alt=""
          fill
          sizes="100vw"
          className="-z-20 object-cover object-[50%_60%] opacity-40"
        />
        <div aria-hidden className="absolute inset-0 -z-10 bg-gradient-to-r from-[var(--color-spring-deep)] via-[var(--color-spring-deep)]/85 to-[var(--color-spring-deep)]/40" />
        <Container className="grid gap-12 py-20 sm:py-28 lg:grid-cols-[7fr_5fr] lg:items-end">
          <div>
            <h2 className="text-display text-[2.6rem] sm:text-7xl">See you on the water.</h2>
            <p className="mt-6 max-w-lg text-lg text-white/80">
              Pick a date, pay online in a couple of minutes, and your
              confirmation arrives right away with everything you need.
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <Button href="/book" size="lg">
                Check availability
                <ArrowRight size={18} />
              </Button>
              <Button href={siteConfig.contact.phoneHref} size="lg" variant="glass">
                <Phone size={18} />
                {siteConfig.contact.phone}
              </Button>
            </div>
          </div>
          <a
            href={siteConfig.marina.mapUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="group block rounded-2xl border border-white/15 bg-white/5 p-6 backdrop-blur-md transition-colors hover:bg-white/10"
          >
            <MapPin size={22} className="text-[var(--color-spring-bright)]" />
            <p className="mt-4 text-lg font-semibold">{siteConfig.marina.name}</p>
            <p className="mt-1 text-white/70">
              {siteConfig.marina.streetAddress}
              <br />
              {siteConfig.marina.city}, {siteConfig.marina.region} {siteConfig.marina.postalCode}
            </p>
            <p className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-[var(--color-spring-bright)]">
              Get directions
              <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" />
            </p>
          </a>
        </Container>
      </section>
    </>
  );
}

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { SiteImage, siteImageUrl } from '@/components/marketing/SiteImage';
import { Container, Section, SectionTitle } from '@/components/marketing/Section';
import { FaqList } from '@/components/marketing/FaqList';
import { ArrowRight, Calendar, Check, Clock, MapPin, Phone, Shield, Users } from '@/components/ui/icons';
import { tourSlotForSlug } from '@/lib/site-images';
import { bookingHref, marinaNow } from '@/lib/availability';
import { NextOpenDates } from '@/components/marketing/NextOpenDates';
import { cruiseSteps, tourDisplayName, tourSteps } from '@/lib/experience';
import { pickFaqs } from '@/lib/faq';
import { tours, formatPrice, slotLabels, type MarketingTour } from '@/lib/tours';
import {
  formatPriceRange,
  formatSeasonDates,
  standardUnitPrice,
  upcomingPriceRange,
  upcomingSeasonsFor,
} from '@/lib/pricing';
import { fetchTourCatalog, findTour, type TourCatalog } from '@/lib/tours-server';
import { siteConfig } from '@/lib/site-config';
import { pageSeo, jsonLdHtml } from '@/lib/seo';
import { tourMetaDescription, tourSeoTitle } from '@/lib/tour-seo';

interface PageProps {
  params: Promise<{ slug: string }>;
}

// Photos and availability both come from Firestore; refresh every minute.
export const revalidate = 60;

// The nine tours are the only pages; anything else is a real 404. Every
// tour gets a page, running or not, so switching one back on in Admin →
// Tours doesn't need a deploy.
export const dynamicParams = false;

export function generateStaticParams() {
  return tours.map((t) => ({ slug: t.slug }));
}

/** `$84/person`, `from $500 flat`: the price line used in titles and lists. */
function tourPriceLabel(t: MarketingTour, catalog: TourCatalog, today: string): string {
  const amount = formatPriceRange(upcomingPriceRange([t], today, catalog.seasons));
  return t.type === 'shared' ? `${amount}/person` : `${amount} flat`;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const catalog = await fetchTourCatalog();
  const tour = findTour(catalog, slug);
  if (!tour) return {};
  const range = upcomingPriceRange([tour], marinaNow().date, catalog.seasons);
  const title = tourSeoTitle(tour, range);
  return {
    // Absolute: the title already ends in "| Crystal River".
    title: { absolute: title },
    description: tourMetaDescription(tour, range),
    ...pageSeo(`/tours/${tour.slug}`, {
      title,
      description: tour.shortDescription,
    }),
  };
}

/** The other tours that leave at this time, then the other times of this type. */
function otherTours(current: MarketingTour, tours: MarketingTour[]): MarketingTour[] {
  const sameTime = tours.filter((t) => t.active && t.slug !== current.slug && t.timeSlot === current.timeSlot);
  const sameType = tours.filter(
    (t) => t.active && t.slug !== current.slug && t.type === current.type && t.timeSlot !== current.timeSlot,
  );
  return [...sameTime, ...sameType].slice(0, 4);
}

const tourFaqs = pickFaqs([
  'Will we definitely see manatees?',
  'Do I need to know how to swim?',
  'What should I bring?',
  'What if the weather is bad?',
  'Do you cancel for rain or cold weather?',
]);

// No swim on the cruise, so no manatee or swimming questions.
const cruiseFaqs = pickFaqs([
  'What if the weather is bad?',
  'Do you cancel for rain or cold weather?',
  'What if I need to cancel?',
  'Can I reschedule?',
]);

export default async function TourPage({ params }: PageProps) {
  const { slug } = await params;
  const catalog = await fetchTourCatalog();
  const tour = findTour(catalog, slug);
  if (!tour) notFound();

  const today = marinaNow().date;
  const isPrivate = tour.type === 'private';
  const isWholeDay = tour.timeSlot === 'whole-day';
  const isCruise = tour.timeSlot === 'sunset';
  const name = tourDisplayName(tour);
  const others = otherTours(tour, catalog.tours);
  const range = upcomingPriceRange([tour], today, catalog.seasons)!;
  const seasonal = upcomingSeasonsFor(tour, today, catalog.seasons);
  const priceLabel = tourPriceLabel(tour, catalog, today);

  // Schema.org structured data — gets Google to show price + availability
  // in the rich snippet for this tour.
  const tourUrl = `${siteConfig.url}/tours/${tour.slug}`;
  const dollars = (cents: number) => (cents / 100).toFixed(2);
  const priceDollars = dollars(standardUnitPrice(tour));
  const photoSlot = tourSlotForSlug(tour.slug) ?? 'dappled';
  const productJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: tour.name,
    description: tour.description,
    // The tour's own photo, the one on the page.
    image: [await siteImageUrl(photoSlot, 'dappled')],
    sku: tour.slug,
    brand: {
      '@type': 'Organization',
      name: siteConfig.name,
      url: siteConfig.url,
    },
    offers:
      range.min === range.max
        ? {
            '@type': 'Offer',
            price: priceDollars,
            priceCurrency: 'USD',
            url: `${siteConfig.url}${bookingHref(tour)}`,
            availability: tour.active ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
            priceSpecification: {
              '@type': 'UnitPriceSpecification',
              price: priceDollars,
              priceCurrency: 'USD',
              unitText: tour.type === 'shared' ? 'per person' : 'flat (up to 6 guests)',
            },
          }
        : {
            // Seasonal rates: the price depends on the date.
            '@type': 'AggregateOffer',
            lowPrice: dollars(range.min),
            highPrice: dollars(range.max),
            priceCurrency: 'USD',
            url: `${siteConfig.url}${bookingHref(tour)}`,
            availability: tour.active ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
          },
  };

  // Breadcrumb schema for Google's breadcrumb display in SERPs.
  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: siteConfig.url },
      { '@type': 'ListItem', position: 2, name: 'Tours', item: `${siteConfig.url}/tours` },
      { '@type': 'ListItem', position: 3, name: tour.name, item: tourUrl },
    ],
  };

  const facts = [
    { icon: Clock, label: 'Departs', value: `${tour.startTimeDisplay}, back ${tour.endTimeDisplay}` },
    { icon: Users, label: 'Group', value: isPrivate ? `Just yours, up to ${tour.maxGuests}` : `Up to ${tour.maxGuests} on board` },
    { icon: MapPin, label: 'From', value: siteConfig.marina.name },
    ...(isCruise ? [{ icon: Calendar, label: 'Season', value: 'Runs April 1 – November 14' }] : []),
  ];

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdHtml(productJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdHtml(breadcrumbJsonLd) }}
      />

      <Section tone="paper" size="sm" className="!pb-0">
        <nav aria-label="Breadcrumb" className="text-sm">
          <ol className="flex flex-wrap items-center gap-2 text-[var(--color-ink-soft)]">
            <li>
              <Link href="/" className="hover:text-[var(--color-ink)]">Home</Link>
            </li>
            <li aria-hidden>/</li>
            <li>
              <Link href="/tours" className="hover:text-[var(--color-ink)]">Tours</Link>
            </li>
            <li aria-hidden>/</li>
            <li aria-current="page" className="text-[var(--color-ink)]">{name}</li>
          </ol>
        </nav>
      </Section>

      <Section tone="paper" size="sm">
        <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-14">
          <div>
            <p className="text-label text-[var(--color-spring)]">
              {isWholeDay ? 'Private charter' : `${slotLabels[tour.timeSlot]} · ${isPrivate ? 'Private' : 'Shared'}`}
            </p>
            <h1 className="mt-3 text-display text-[2.5rem] sm:text-6xl">{name}</h1>
            <p className="mt-5 max-w-2xl text-lg leading-relaxed text-[var(--color-ink-soft)]">
              {tour.description}
            </p>
            <SiteImage
              slot={photoSlot}
              fallbackSlot="dappled"
              aspect="auto"
              rounded="2xl"
              className="mt-10 aspect-[16/10]"
              alt={`${name} — feature photo`}
              priority
              sizes="(min-width: 1024px) 720px, 100vw"
            />
          </div>

          <aside className="lg:sticky lg:top-24">
            <div className="overflow-hidden rounded-2xl border border-[var(--color-sand)] bg-white">
              <div className="p-6 sm:p-7">
                <p className="flex items-baseline gap-2">
                  {range.min !== range.max && <span className="text-[var(--color-ink-soft)]">from</span>}
                  <span className="text-display text-[2.75rem] tabular-nums">{formatPrice(range.min)}</span>
                  <span className="text-[var(--color-ink-soft)]">
                    {isPrivate ? `for up to ${tour.maxGuests}` : 'per person'}
                  </span>
                </p>
                {seasonal.length > 0 && (
                  <ul className="mt-4 space-y-1.5 text-sm">
                    {seasonal.map((s) => (
                      <li key={s.id} className="flex justify-between gap-4">
                        <span className="text-[var(--color-ink-soft)]">
                          {s.name}, {formatSeasonDates(s, today)}
                        </span>
                        <span className="font-semibold tabular-nums">{formatPrice(s.price)}</span>
                      </li>
                    ))}
                    <li className="flex justify-between gap-4">
                      <span className="text-[var(--color-ink-soft)]">Other dates</span>
                      <span className="font-semibold tabular-nums">{formatPrice(standardUnitPrice(tour))}</span>
                    </li>
                  </ul>
                )}
                <dl className="mt-5 space-y-3 border-t border-[var(--color-sand)] pt-5 text-[0.9375rem]">
                  {facts.map(({ icon: Icon, label, value }) => (
                    <div key={label} className="flex items-start gap-3">
                      <Icon size={18} className="mt-0.5 shrink-0 text-[var(--color-spring)]" />
                      <dt className="sr-only">{label}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
                </dl>
              </div>

              <div className="border-t border-[var(--color-sand)] bg-[var(--color-paper)] p-6 sm:p-7">
                {tour.active ? (
                  <NextOpenDates slug={tour.slug} />
                ) : (
                  <>
                    <p className="font-semibold">Not running right now</p>
                    <p className="mt-2 text-sm text-[var(--color-ink-soft)]">
                      Travis isn&rsquo;t offering this tour at the moment. The
                      other departures below are bookable, or call and ask.
                    </p>
                    <Button href="/book" size="lg" className="mt-5 w-full">
                      See open departures
                      <ArrowRight size={18} />
                    </Button>
                  </>
                )}
                <a
                  href={siteConfig.contact.phoneHref}
                  className="mt-4 flex items-center justify-center gap-2 text-sm font-medium text-[var(--color-ink-soft)] hover:text-[var(--color-ink)]"
                >
                  <Phone size={15} />
                  Or call {siteConfig.contact.phone}
                </a>
              </div>
            </div>

            <p className="mt-4 flex gap-2.5 px-1 text-sm text-[var(--color-ink-soft)]">
              <Shield size={18} className="shrink-0 text-[var(--color-spring)]" />
              Full refund up to 72 hours before. Weather cancellations are always refunded in full.
            </p>
          </aside>
        </div>
      </Section>

      <Section tone="white" size="lg">
        <div className="grid gap-14 lg:grid-cols-2 lg:gap-20">
          <div>
            <h2 className="text-display text-[2rem] sm:text-[2.6rem]">What&rsquo;s included</h2>
            <ul className="mt-8 divide-y divide-[var(--color-sand)] border-y border-[var(--color-sand)]">
              {tour.included.map((item) => (
                <li key={item} className="flex items-start gap-3 py-4 text-[1.0625rem]">
                  <Check size={20} className="mt-0.5 shrink-0 text-[var(--color-spring)]" />
                  {item}
                </li>
              ))}
            </ul>
            <p className="mt-6 text-[var(--color-ink-soft)]">
              {isCruise
                ? 'It’s BYOB: bring your own drinks and food.'
                : 'Bring a swimsuit, a towel, and reef-safe sunscreen.'}
            </p>
          </div>
          <div>
            <h2 className="text-display text-[2rem] sm:text-[2.6rem]">How it goes</h2>
            <ol className="mt-8 space-y-7">
              {(isCruise ? cruiseSteps : tourSteps).map((s, i) => (
                <li key={s.title} className="grid grid-cols-[2.5rem_1fr] gap-4">
                  <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-[var(--color-mist)] text-display text-[var(--color-spring)] tabular-nums">
                    {i + 1}
                  </span>
                  <div className="pt-1">
                    <h3 className="font-bold">{s.title}</h3>
                    <p className="mt-1 leading-relaxed text-[var(--color-ink-soft)]">{s.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </Section>

      {others.length > 0 && (
        <Section tone="paper" size="md">
          <SectionTitle title="Other ways to go" />
          <ul className="mt-10 grid gap-3 sm:grid-cols-2">
            {others.map((t) => (
              <li key={t.slug}>
                <Link
                  href={`/tours/${t.slug}`}
                  className="group flex items-center justify-between gap-4 rounded-xl border border-[var(--color-sand)] bg-white px-5 py-4 transition-colors hover:border-[var(--color-ink)]"
                >
                  <span>
                    <span className="block font-semibold">{tourDisplayName(t)}</span>
                    <span className="block text-sm text-[var(--color-ink-soft)] tabular-nums">
                      {t.startTimeDisplay} – {t.endTimeDisplay} · {tourPriceLabel(t, catalog, today)}
                    </span>
                  </span>
                  <ArrowRight size={18} className="shrink-0 text-[var(--color-ink-soft)] transition-transform group-hover:translate-x-0.5" />
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section tone="white" size="lg">
        <div className="grid gap-12 lg:grid-cols-[5fr_7fr] lg:gap-20">
          <SectionTitle
            title="Before you book"
            description={
              <>
                The questions people ask about this tour. Everything else is on the{' '}
                <Link href="/faq" className="font-medium text-[var(--color-ink)] underline underline-offset-2">
                  FAQ page
                </Link>
                .
              </>
            }
          />
          <FaqList faqs={isCruise ? cruiseFaqs : tourFaqs} />
        </div>
      </Section>

      <section className="bg-[var(--color-spring-deep)] text-white">
        <Container className="flex flex-col gap-8 py-16 sm:py-20 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-display text-[2.1rem] sm:text-5xl">{name}</h2>
            <p className="mt-3 text-lg text-white/75 tabular-nums">
              {tour.startTimeDisplay} – {tour.endTimeDisplay} · {priceLabel}
            </p>
          </div>
          <Button href={tour.active ? bookingHref(tour) : '/book'} size="lg">
            {tour.active ? 'Check availability' : 'See open departures'}
            <ArrowRight size={18} />
          </Button>
        </Container>
      </section>
    </>
  );
}

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { SiteImage } from '@/components/marketing/SiteImage';
import { tourSlotForSlug } from '@/lib/site-images';
import { Section, SectionTitle } from '@/components/marketing/Section';
import { TourCard } from '@/components/marketing/TourCard';
import {
  tours,
  getTourBySlug,
  formatTourPrice,
  type MarketingTour,
} from '@/lib/tours';
import { siteConfig } from '@/lib/site-config';

interface PageProps {
  params: Promise<{ slug: string }>;
}

// Each tour page reads admin-uploaded photos from Firestore. Revalidate
// every 60s so changes via /admin/photos propagate without a redeploy.
export const revalidate = 60;

export function generateStaticParams() {
  return tours.filter((t) => t.active).map((t) => ({ slug: t.slug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const tour = getTourBySlug(slug);
  if (!tour) return {};
  const title = `${tour.name} — ${formatTourPrice(tour)}`;
  return {
    title,
    description: tour.description,
    alternates: { canonical: `${siteConfig.url}/tours/${tour.slug}` },
    openGraph: {
      title: `${tour.name} — Crystal River Manatee Fun`,
      description: tour.shortDescription,
    },
  };
}

function similarTours(current: MarketingTour): MarketingTour[] {
  return tours
    .filter((t) => t.slug !== current.slug && t.active)
    .filter((t) => t.timeSlot === current.timeSlot || t.type === current.type)
    .slice(0, 3);
}

export default async function TourPage({ params }: PageProps) {
  const { slug } = await params;
  const tour = getTourBySlug(slug);
  if (!tour) notFound();

  const similar = similarTours(tour);
  const isPrivate = tour.type === 'private';

  return (
    <>
      <Section tone="cream" size="md">
        <nav aria-label="Breadcrumb" className="mb-4 text-sm">
          <ol className="flex items-center gap-2 text-[var(--color-ink-soft)]">
            <li>
              <Link href="/" className="hover:text-[var(--color-brand-blue)]">
                Home
              </Link>
            </li>
            <li aria-hidden>/</li>
            <li>
              <Link href="/tours" className="hover:text-[var(--color-brand-blue)]">
                Tours
              </Link>
            </li>
            <li aria-hidden>/</li>
            <li aria-current="page" className="text-[var(--color-ink)]">
              {tour.name}
            </li>
          </ol>
        </nav>

        <div className="grid gap-10 lg:grid-cols-12 lg:items-start">
          <div className="lg:col-span-7">
            <SiteImage
              slot={tourSlotForSlug(tour.slug) ?? 'dappled'}
              fallbackSlot="dappled"
              aspect="wide"
              alt={`${tour.name} — feature photo`}
              tone={
                isPrivate
                  ? 'bg-[var(--color-coral)]/15'
                  : 'bg-[var(--color-brand-blue)]/15'
              }
            />
          </div>

          <aside className="lg:col-span-5 lg:sticky lg:top-24 bg-white rounded-2xl p-6 sm:p-8 border border-[var(--color-ink)]/8 shadow-[var(--shadow-card)]">
            <div className="flex flex-wrap gap-2">
              <span
                className={
                  isPrivate
                    ? 'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-[var(--color-coral)]/15 text-[var(--color-coral-dark)]'
                    : 'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-[var(--color-brand-blue)]/15 text-[var(--color-brand-blue-dark)]'
                }
              >
                {isPrivate ? 'Private whole-boat' : 'Shared'}
              </span>
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-[var(--color-manatee)]/20 text-[var(--color-ink)]">
                {tour.durationHours} hours
              </span>
            </div>

            <h1 className="mt-4 font-display text-3xl sm:text-4xl leading-tight">
              {tour.name}
            </h1>
            <p className="mt-2 text-[var(--color-ink-soft)]">{tour.shortDescription}</p>

            <dl className="mt-6 space-y-3 text-sm">
              <div className="flex justify-between gap-4 border-b border-[var(--color-ink)]/8 pb-3">
                <dt className="text-[var(--color-ink-soft)]">Start time</dt>
                <dd className="font-medium">{tour.startTimeDisplay}</dd>
              </div>
              <div className="flex justify-between gap-4 border-b border-[var(--color-ink)]/8 pb-3">
                <dt className="text-[var(--color-ink-soft)]">Duration</dt>
                <dd className="font-medium">{tour.durationHours} hours</dd>
              </div>
              <div className="flex justify-between gap-4 border-b border-[var(--color-ink)]/8 pb-3">
                <dt className="text-[var(--color-ink-soft)]">Max guests</dt>
                <dd className="font-medium">{tour.maxGuests}</dd>
              </div>
              <div className="flex justify-between gap-4 border-b border-[var(--color-ink)]/8 pb-3">
                <dt className="text-[var(--color-ink-soft)]">Departs from</dt>
                <dd className="font-medium text-right">{siteConfig.marina.name}</dd>
              </div>
            </dl>

            <div className="mt-6 flex items-baseline justify-between">
              <p className="text-sm text-[var(--color-ink-soft)]">Price</p>
              <p className="font-display text-3xl text-[var(--color-brand-blue)]">
                {formatTourPrice(tour)}
              </p>
            </div>

            <Button
              href={`/book/${tour.slug}`}
              size="lg"
              className="mt-4 w-full"
            >
              Book this tour
            </Button>
            <a
              href={siteConfig.contact.phoneHref}
              className="mt-3 block text-center text-sm text-[var(--color-brand-blue)] hover:text-[var(--color-brand-blue-dark)]"
            >
              Or call {siteConfig.contact.phone}
            </a>
          </aside>
        </div>
      </Section>

      <Section tone="white" size="md">
        <div className="grid gap-10 lg:grid-cols-12">
          <div className="lg:col-span-7">
            <h2 className="font-display text-2xl sm:text-3xl">About this tour</h2>
            <p className="mt-4 text-base sm:text-lg leading-relaxed text-[var(--color-ink-soft)]">
              {tour.description}
            </p>
          </div>
          <div className="lg:col-span-5">
            <h2 className="font-display text-2xl sm:text-3xl">What&rsquo;s included</h2>
            <ul className="mt-4 space-y-3">
              {tour.included.map((item) => (
                <li key={item} className="flex gap-3 items-start">
                  <span className="mt-0.5 inline-flex w-5 h-5 shrink-0 items-center justify-center rounded-full bg-[var(--color-brand-blue)] text-white">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
                      <path
                        d="M5 12.5l4 4 10-10"
                        stroke="currentColor"
                        strokeWidth="3"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                  <span className="text-sm sm:text-base text-[var(--color-ink)]">
                    {item}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Section>

      {similar.length > 0 && (
        <Section tone="cream" size="md">
          <SectionTitle
            eyebrow="Other tours"
            title="You might also like"
            align="left"
          />
          <div className="mt-8 grid gap-6 md:grid-cols-3">
            {similar.map((t) => (
              <TourCard key={t.slug} tour={t} />
            ))}
          </div>
        </Section>
      )}
    </>
  );
}

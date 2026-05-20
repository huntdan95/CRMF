import type { Metadata } from 'next';
import Link from 'next/link';
import { Section, SectionTitle } from '@/components/marketing/Section';
import { Button } from '@/components/ui/Button';
import { fetchPublishedTestimonials } from '@/lib/testimonials-server';
import { siteConfig } from '@/lib/site-config';
import { clsx } from '@/lib/clsx';

export const revalidate = 60;

export const metadata: Metadata = {
  title: 'Reviews — What Guests Say About Crystal River Manatee Fun',
  description:
    'Reviews from real guests of Capt. Travis Urbin\'s manatee tours on the Crystal River — from Google, Tripadvisor, Instagram, and direct from the dock.',
  alternates: { canonical: `${siteConfig.url}/reviews` },
};

const SOURCE_LABELS: Record<string, string> = {
  google: 'Google',
  tripadvisor: 'Tripadvisor',
  facebook: 'Facebook',
  instagram: 'Instagram',
  direct: 'Sent directly',
  other: '',
};

function formatReviewDate(iso: string | null): string | null {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map((n) => Number.parseInt(n, 10));
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });
}

export default async function ReviewsPage() {
  const reviews = await fetchPublishedTestimonials();
  const ratedCount = reviews.filter((r) => r.rating).length;
  const avgRating =
    ratedCount > 0
      ? reviews
          .filter((r) => r.rating)
          .reduce((sum, r) => sum + (r.rating ?? 0), 0) / ratedCount
      : null;

  return (
    <>
      <Section tone="cream" size="md">
        <div className="max-w-3xl">
          <p className="text-xs sm:text-sm font-medium uppercase tracking-[0.3em] text-[var(--color-coral-dark)]">
            Reviews
          </p>
          <h1 className="mt-4 font-display text-5xl sm:text-6xl lg:text-7xl leading-[1.02]">
            What guests say.
          </h1>
          {reviews.length > 0 && (
            <p className="mt-5 text-base sm:text-lg text-[var(--color-ink-soft)]">
              {reviews.length} review{reviews.length === 1 ? '' : 's'} on file.
              {avgRating != null && (
                <>
                  {' '}Average{' '}
                  <span className="font-medium text-[var(--color-ink)]">
                    {avgRating.toFixed(1)} / 5
                  </span>
                  <span className="ml-1 text-[var(--color-coral-dark)]">
                    {'★'.repeat(Math.round(avgRating))}
                  </span>
                </>
              )}
            </p>
          )}
        </div>
      </Section>

      <Section tone="white" size="lg">
        {reviews.length === 0 ? (
          <div className="max-w-md mx-auto text-center rounded-2xl bg-[var(--color-cream)] border border-[var(--color-ink)]/8 p-8">
            <p className="font-display text-xl">No reviews on file yet.</p>
            <p className="mt-3 text-sm text-[var(--color-ink-soft)]">
              Travis collects reviews after every tour. Until then, you can
              check{' '}
              <a
                href={siteConfig.captain.instagram}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[var(--color-brand-blue)] hover:underline"
              >
                Instagram
              </a>{' '}
              for guest photos and tagged tours.
            </p>
          </div>
        ) : (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 max-w-6xl mx-auto">
            {reviews.map((r) => (
              <article
                key={r.id}
                className={clsx(
                  'bg-[var(--color-cream)] rounded-2xl p-6 sm:p-7 border border-[var(--color-ink)]/8',
                  'flex flex-col',
                )}
              >
                {r.rating && (
                  <p
                    className="text-[var(--color-coral)] text-xl mb-3"
                    aria-label={`${r.rating} out of 5 stars`}
                  >
                    {'★'.repeat(r.rating)}
                    <span className="text-[var(--color-ink)]/15">
                      {'★'.repeat(5 - r.rating)}
                    </span>
                  </p>
                )}
                <p className="font-display text-lg sm:text-xl leading-snug text-[var(--color-ink)]">
                  &ldquo;{r.quote}&rdquo;
                </p>
                <div className="mt-auto pt-5 text-sm">
                  <p className="font-medium text-[var(--color-ink)]">
                    {r.author}
                    {r.location && (
                      <span className="text-[var(--color-ink-soft)] font-normal">
                        {' '}· {r.location}
                      </span>
                    )}
                  </p>
                  <p className="mt-1 text-xs uppercase tracking-[0.15em] text-[var(--color-ink-soft)]">
                    {SOURCE_LABELS[r.source] || ''}
                    {formatReviewDate(r.reviewedAt) && (
                      <>
                        {' '}
                        {SOURCE_LABELS[r.source] ? '·' : ''}{' '}
                        {formatReviewDate(r.reviewedAt)}
                      </>
                    )}
                    {r.sourceUrl && (
                      <>
                        {' '}·{' '}
                        <a
                          href={r.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[var(--color-brand-blue)] hover:underline normal-case tracking-normal"
                        >
                          Read on {SOURCE_LABELS[r.source] || 'source'} ↗
                        </a>
                      </>
                    )}
                  </p>
                </div>
              </article>
            ))}
          </div>
        )}
      </Section>

      <Section tone="blue" size="md">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="font-display text-3xl sm:text-4xl lg:text-5xl text-white leading-[1.05]">
            Be the next happy guest.
          </h2>
          <p className="mt-5 text-lg text-white/85">
            Book a tour, swim with manatees, post a photo, tag us on Instagram
            — and your review might be the next one a future guest reads to
            decide.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Button href="/book" size="lg">
              Book a tour
            </Button>
            <Link
              href="/about"
              className="inline-flex items-center px-7 py-3.5 rounded-full bg-white/10 hover:bg-white/20 text-white font-medium text-lg transition-colors"
            >
              About Capt. Travis
            </Link>
          </div>
        </div>
      </Section>
    </>
  );
}

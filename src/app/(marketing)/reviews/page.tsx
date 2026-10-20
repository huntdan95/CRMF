import type { Metadata } from 'next';
import { Button } from '@/components/ui/Button';
import { Container, Section, SectionTitle } from '@/components/marketing/Section';
import { ArrowRight, ArrowUpRight, Instagram, Star } from '@/components/ui/icons';
import { fetchPublishedTestimonials } from '@/lib/testimonials-server';
import { siteConfig } from '@/lib/site-config';
import { pageSeo } from '@/lib/seo';

export const revalidate = 60;

const title = 'Reviews — What Guests Say About Crystal River Manatee Fun';
const description =
  "A selection of reviews from real guests of Capt. Travis Urbin's manatee tours on the Crystal River — from Google, Tripadvisor, Instagram, and direct from the dock.";

export const metadata: Metadata = {
  title,
  description,
  ...pageSeo('/reviews', { title, description }),
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
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

export default async function ReviewsPage() {
  // Travis picks which reviews appear, so the page says it's a selection
  // and shows no average: an average of hand-picked reviews would read as
  // the business's overall rating (FTC review rule, 16 CFR 465.7).
  const reviews = await fetchPublishedTestimonials();

  return (
    <>
      <Section tone="paper" size="md" className="!pb-10">
        <SectionTitle
          as="h1"
          size="lg"
          title="What guests say"
          description={
            reviews.length > 0 ? (
              <>
                A selection of what guests have said, picked by Travis.
                {siteConfig.googleBusinessProfile && (
                  <>
                    {' '}
                    <a
                      href={siteConfig.googleBusinessProfile}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium text-[var(--color-spring)] underline underline-offset-2 hover:text-[var(--color-ink)]"
                    >
                      Read every review on Google
                    </a>
                    .
                  </>
                )}
              </>
            ) : (
              'Travis asks every group how their tour went. Their reviews will show up here.'
            )
          }
        />
      </Section>

      <Section tone="paper" size="sm" className="!pt-0 pb-20 sm:pb-28">
        {reviews.length === 0 ? (
          <div className="grid gap-6 rounded-2xl border border-[var(--color-sand)] bg-white p-7 sm:p-10 lg:grid-cols-[1fr_auto] lg:items-center">
            <div>
              <h2 className="text-2xl font-bold">In the meantime</h2>
              <p className="mt-2 max-w-xl leading-relaxed text-[var(--color-ink-soft)]">
                Guests tag their tours on Instagram, and Travis is happy to
                answer anything by phone before you book.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button
                href={siteConfig.captain.instagram}
                variant="dark"
                target="_blank"
                rel="noopener noreferrer"
              >
                <Instagram size={18} />
                See guest photos
              </Button>
              <Button href={siteConfig.contact.phoneHref} variant="outline">
                Call {siteConfig.contact.phone}
              </Button>
            </div>
          </div>
        ) : (
          <ul className="columns-1 gap-6 md:columns-2 lg:columns-3 [&>li]:mb-6">
            {reviews.map((r) => {
              const source = SOURCE_LABELS[r.source] || '';
              const when = formatReviewDate(r.reviewedAt);
              return (
                <li key={r.id} className="break-inside-avoid">
                  <figure className="rounded-2xl border border-[var(--color-sand)] bg-white p-7">
                    {r.rating && (
                      <p className="flex gap-0.5" aria-label={`${r.rating} out of 5 stars`}>
                        {Array.from({ length: 5 }, (_, i) => (
                          <Star
                            key={i}
                            size={17}
                            className={i < r.rating! ? 'text-[var(--color-buoy)]' : 'text-[var(--color-sand)]'}
                          />
                        ))}
                      </p>
                    )}
                    <blockquote className="mt-4 text-[1.0625rem] leading-relaxed">&ldquo;{r.quote}&rdquo;</blockquote>
                    <figcaption className="mt-6 border-t border-[var(--color-sand)] pt-4 text-sm">
                      <p className="font-semibold">
                        {r.author}
                        {r.location && <span className="font-normal text-[var(--color-ink-soft)]"> · {r.location}</span>}
                      </p>
                      {(source || when || r.sourceUrl) && (
                        <p className="mt-1 text-[var(--color-ink-soft)]">
                          {[source, when].filter(Boolean).join(' · ')}
                          {r.sourceUrl && (
                            <>
                              {(source || when) && ' · '}
                              <a
                                href={r.sourceUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-0.5 font-medium text-[var(--color-spring)] hover:text-[var(--color-ink)]"
                              >
                                Read on {source || 'source'}
                                <ArrowUpRight size={13} />
                              </a>
                            </>
                          )}
                        </p>
                      )}
                    </figcaption>
                  </figure>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <section className="bg-[var(--color-spring-deep)] text-white">
        <Container className="flex flex-col gap-8 py-16 sm:py-20 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-display text-[2.1rem] sm:text-5xl">See for yourself.</h2>
            <p className="mt-3 text-lg text-white/75">Six guests at most, with Travis in the water alongside you.</p>
          </div>
          <Button href="/book" size="lg">
            Check availability
            <ArrowRight size={18} />
          </Button>
        </Container>
      </section>
    </>
  );
}

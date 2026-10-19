import type { Metadata } from 'next';
import { Button } from '@/components/ui/Button';
import { Container, Section, SectionTitle } from '@/components/marketing/Section';
import { FaqList } from '@/components/marketing/FaqList';
import { ArrowRight, Phone } from '@/components/ui/icons';
import { faqSectionsWithPrices } from '@/lib/faq';
import { siteConfig } from '@/lib/site-config';
import { pageSeo } from '@/lib/seo';
import { marinaNow } from '@/lib/availability';
import { kindPriceRanges } from '@/lib/pricing';
import { fetchTourCatalog } from '@/lib/tours-server';

// The price answer quotes the live prices from Admin → Tours.
export const revalidate = 60;

const title = 'Swim with Manatees FAQ';
const description =
  "Answers to the most common Crystal River Manatee Fun questions: what to wear, weather, cancellations, age limits, water clarity, and what's included.";

export const metadata: Metadata = {
  title,
  description,
  ...pageSeo('/faq', { title, description }),
};

export default async function FaqPage() {
  const catalog = await fetchTourCatalog();
  const faqSections = faqSectionsWithPrices(
    kindPriceRanges(catalog.tours, marinaNow().date, catalog.seasons),
  );
  // JSON-LD for FAQ rich result
  const faqJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqSections.flatMap((s) =>
      s.faqs.map((f) => ({
        '@type': 'Question',
        name: f.q,
        acceptedAnswer: { '@type': 'Answer', text: f.a },
      })),
    ),
  };

  return (
    <>
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />

      <Section tone="paper" size="md" className="!pb-10">
        <SectionTitle
          as="h1"
          size="lg"
          title="Swim with manatees in Crystal River: FAQ"
          description="If yours isn’t here, call Travis directly. He picks up when he isn’t on the water."
        />
      </Section>

      <Section tone="paper" size="sm" className="!pt-0 pb-20 sm:pb-28">
        <div className="grid gap-12 lg:grid-cols-[16rem_minmax(0,1fr)] lg:gap-20">
          <aside className="lg:sticky lg:top-24 lg:self-start">
            <nav aria-label="FAQ topics">
              <p className="text-label text-[var(--color-ink-soft)]">Topics</p>
              <ul className="mt-4 flex flex-wrap gap-2 lg:flex-col lg:gap-1">
                {faqSections.map((s) => (
                  <li key={s.id}>
                    <a
                      href={`#${s.id}`}
                      className="block rounded-lg border border-[var(--color-ink)]/12 bg-white px-3.5 py-2 text-sm font-medium transition-colors hover:border-[var(--color-ink)] lg:border-transparent lg:bg-transparent lg:px-0 lg:py-1.5 lg:text-[0.9375rem] lg:text-[var(--color-ink-soft)] lg:hover:text-[var(--color-ink)]"
                    >
                      {s.heading}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
            <a
              href={siteConfig.contact.phoneHref}
              className="mt-8 hidden items-center gap-2 font-semibold tabular-nums hover:text-[var(--color-spring)] lg:inline-flex"
            >
              <Phone size={18} />
              {siteConfig.contact.phone}
            </a>
          </aside>

          <div className="space-y-16">
            {faqSections.map((section) => (
              <section key={section.id} id={section.id} aria-labelledby={`${section.id}-h`}>
                <h2 id={`${section.id}-h`} className="text-display text-[1.75rem] sm:text-[2.1rem]">
                  {section.heading}
                </h2>
                <div className="mt-6">
                  <FaqList faqs={section.faqs} />
                </div>
              </section>
            ))}
          </div>
        </div>
      </Section>

      <section className="bg-[var(--color-spring-deep)] text-white">
        <Container className="flex flex-col gap-8 py-16 sm:py-20 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-display text-[2.1rem] sm:text-5xl">Still have a question?</h2>
            <p className="mt-3 text-lg text-white/75">
              Call, text, or send a message. Travis usually replies the same day.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button href={siteConfig.contact.phoneHref} size="lg" variant="light">
              <Phone size={18} />
              {siteConfig.contact.phone}
            </Button>
            <Button href="/contact" size="lg" variant="glass">
              Send a message
              <ArrowRight size={18} />
            </Button>
          </div>
        </Container>
      </section>
    </>
  );
}

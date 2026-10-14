import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { Container, Section, SectionTitle } from '@/components/marketing/Section';
import { ArrowRight } from '@/components/ui/icons';
import { siteConfig } from '@/lib/site-config';
import { Button } from '@/components/ui/Button';
import { formatPostDate, getAllPosts } from '@/lib/news';
import { pageSeo } from '@/lib/seo';

const title = 'News — Manatee Stories from Crystal River';
const description =
  'Notes from Capt. Travis Urbin’s manatee tours on the Crystal River: what manatees eat, where they live, guest stories and footage from Kings Bay.';

export const metadata: Metadata = {
  title,
  description,
  ...pageSeo('/news', { title, description }),
};

export default function NewsIndexPage() {
  const posts = getAllPosts();

  const [lead, ...rest] = posts;

  return (
    <>
      <Section tone="paper" size="md" className="!pb-10">
        <SectionTitle
          as="h1"
          size="lg"
          title="Notes from the river"
          description="Stories, footage, and manatee facts from Capt. Travis’s tours on Kings Bay."
        />
      </Section>

      <Section tone="paper" size="sm" className="!pt-0 pb-20 sm:pb-28">
        {lead && (
          <Link
            href={`/news/${lead.slug}`}
            className="group grid overflow-hidden rounded-2xl border border-[var(--color-sand)] bg-white transition-shadow hover:shadow-[var(--shadow-lift)] lg:grid-cols-2"
          >
            <div className="relative aspect-[4/3] overflow-hidden bg-[var(--color-spring-deep)] lg:aspect-auto lg:min-h-[420px]">
              {lead.image ? (
                <Image
                  src={lead.image}
                  alt={lead.imageAlt}
                  fill
                  priority
                  sizes="(min-width: 1024px) 620px, 100vw"
                  className="object-cover transition-transform duration-700 ease-out group-hover:scale-[1.03]"
                />
              ) : (
                <span className="absolute inset-0 flex items-center justify-center text-label text-white/70">Video</span>
              )}
            </div>
            <div className="flex flex-col p-7 sm:p-10">
              <time dateTime={lead.date} className="text-sm text-[var(--color-ink-soft)]">
                {formatPostDate(lead.date)}
              </time>
              <h2 className="mt-3 text-display text-[1.9rem] sm:text-[2.4rem]">{lead.title}</h2>
              <p className="mt-4 text-lg leading-relaxed text-[var(--color-ink-soft)]">{lead.description}</p>
              <span className="mt-auto inline-flex items-center gap-2 pt-8 font-semibold text-[var(--color-spring)]">
                Read the story
                <ArrowRight size={18} className="transition-transform group-hover:translate-x-0.5" />
              </span>
            </div>
          </Link>
        )}

        {rest.length > 0 && (
          <ul className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {rest.map((post) => (
              <li key={post.slug}>
                <Link
                  href={`/news/${post.slug}`}
                  className="group flex h-full flex-col overflow-hidden rounded-2xl border border-[var(--color-sand)] bg-white transition-shadow hover:shadow-[var(--shadow-lift)]"
                >
                  <div className="relative aspect-[4/3] overflow-hidden bg-[var(--color-spring-deep)]">
                    {post.image ? (
                      <Image
                        src={post.image}
                        alt={post.imageAlt}
                        fill
                        sizes="(min-width: 1024px) 400px, (min-width: 640px) 50vw, 100vw"
                        className="object-cover transition-transform duration-700 ease-out group-hover:scale-[1.04]"
                      />
                    ) : (
                      <span className="absolute inset-0 flex items-center justify-center text-label text-white/70">
                        Video
                      </span>
                    )}
                  </div>
                  <div className="flex flex-1 flex-col p-6">
                    <time dateTime={post.date} className="text-sm text-[var(--color-ink-soft)]">
                      {formatPostDate(post.date)}
                    </time>
                    <h2 className="mt-2 text-xl font-bold leading-snug">{post.title}</h2>
                    <p className="mt-3 leading-relaxed text-[var(--color-ink-soft)]">{post.description}</p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <section className="bg-[var(--color-spring-deep)] text-white">
        <Container className="flex flex-col gap-8 py-16 sm:py-20 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-display text-[2.1rem] sm:text-5xl">See it for yourself.</h2>
            <p className="mt-3 text-lg text-white/75">
              Shared and private tours from {siteConfig.marina.name}, six guests at most.
            </p>
          </div>
          <Button href="/tours" size="lg">
            See the tours
            <ArrowRight size={18} />
          </Button>
        </Container>
      </section>
    </>
  );
}

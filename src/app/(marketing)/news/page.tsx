import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { Section } from '@/components/marketing/Section';
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

  return (
    <>
      <section className="bg-[var(--color-cream)] border-b border-[var(--color-ink)]/8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-24">
          <p className="text-xs sm:text-sm font-medium uppercase tracking-[0.3em] text-[var(--color-coral-dark)]">
            News
          </p>
          <h1 className="mt-4 font-display text-5xl sm:text-6xl lg:text-7xl leading-[1.02] max-w-3xl">
            Notes from the river.
          </h1>
          <p className="mt-6 max-w-xl text-lg text-[var(--color-ink-soft)] leading-relaxed">
            Stories, footage and manatee facts from Capt. Travis&rsquo;s tours
            on Kings Bay.
          </p>
        </div>
      </section>

      <Section tone="white" size="lg">
        <ul className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
          {posts.map((post) => (
            <li key={post.slug}>
              <Link
                href={`/news/${post.slug}`}
                className="group flex h-full flex-col overflow-hidden rounded-2xl bg-[var(--color-cream)] border border-[var(--color-ink)]/8 shadow-[var(--shadow-card)] hover:shadow-[var(--shadow-soft)] transition-shadow"
              >
                <div className="relative aspect-[4/3] overflow-hidden bg-[var(--color-brand-blue)]/15">
                  {post.image ? (
                    <Image
                      src={post.image}
                      alt={post.imageAlt}
                      fill
                      sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                      className="object-cover transition-transform duration-700 ease-out group-hover:scale-105"
                    />
                  ) : (
                    <span className="absolute inset-0 flex items-center justify-center text-xs font-semibold uppercase tracking-[0.3em] text-[var(--color-brand-blue)]">
                      Video
                    </span>
                  )}
                </div>
                <div className="flex flex-1 flex-col p-6">
                  <time
                    dateTime={post.date}
                    className="text-xs font-medium uppercase tracking-[0.14em] text-[var(--color-ink-soft)]"
                  >
                    {formatPostDate(post.date)}
                  </time>
                  <h2 className="mt-2 font-display text-2xl leading-tight group-hover:text-[var(--color-brand-blue)] transition-colors">
                    {post.title}
                  </h2>
                  <p className="mt-3 text-sm leading-relaxed text-[var(--color-ink-soft)]">
                    {post.description}
                  </p>
                  <span className="mt-auto pt-5 text-sm font-medium text-[var(--color-brand-blue)]">
                    Read more →
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </Section>

      <Section tone="cream" size="md">
        <div className="text-center max-w-xl mx-auto">
          <h2 className="font-display text-3xl sm:text-4xl leading-tight">
            See it for yourself.
          </h2>
          <p className="mt-4 text-[var(--color-ink-soft)]">
            Shared and private manatee tours from Pete&rsquo;s Pier Marina,
            six guests at most.
          </p>
          <div className="mt-6 flex justify-center gap-3 flex-wrap">
            <Button href="/tours" size="lg">
              See the tours
            </Button>
          </div>
        </div>
      </Section>
    </>
  );
}

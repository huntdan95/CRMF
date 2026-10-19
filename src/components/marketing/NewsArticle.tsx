import Image from 'next/image';
import Link from 'next/link';
import { Section } from '@/components/marketing/Section';
import { formatPostDate, type NewsPost } from '@/lib/news';
import { siteConfig } from '@/lib/site-config';

/**
 * A post's headline, featured photo and body: the live post page, and the
 * page Travis reviews a grokbot draft on, so he approves exactly what will
 * go up.
 */
export function NewsArticle({ post }: { post: NewsPost }) {
  return (
    <>
      <Section tone="paper" size="md" container="prose" className="!pb-10">
        <nav aria-label="Breadcrumb" className="text-sm">
          <ol className="flex flex-wrap items-center gap-2 text-[var(--color-ink-soft)]">
            <li>
              <Link href="/" className="hover:text-[var(--color-ink)]">Home</Link>
            </li>
            <li aria-hidden>/</li>
            <li>
              <Link href="/news" className="hover:text-[var(--color-ink)]">News</Link>
            </li>
          </ol>
        </nav>
        <h1 className="mt-8 text-display text-[2.4rem] sm:text-[3.5rem]">{post.title}</h1>
        <p className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-1 text-[var(--color-ink-soft)]">
          <time dateTime={post.date}>{formatPostDate(post.date)}</time>
          <span aria-hidden>·</span>
          <Link href="/about#captain" className="hover:text-[var(--color-ink)]">
            {siteConfig.captain.fullName}
          </Link>
        </p>
      </Section>

      {post.hero && (
        <Section tone="paper" size="sm" container="prose" className="!pt-0 !pb-10">
          <Image
            src={post.hero.url}
            alt={post.hero.alt}
            width={post.hero.width}
            height={post.hero.height}
            priority
            sizes="(min-width: 800px) 760px, 100vw"
            className="w-full rounded-2xl"
          />
        </Section>
      )}

      <Section tone="paper" size="sm" container="prose" className="!pt-0 pb-20 sm:pb-24">
        <article
          className="prose-river"
          // Rendered from content/news, or from grokbot's Markdown with raw
          // HTML, odd links and outside images stripped (src/lib/news.ts).
          dangerouslySetInnerHTML={{ __html: post.html }}
        />
      </Section>
    </>
  );
}

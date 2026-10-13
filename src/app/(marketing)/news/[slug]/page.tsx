import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Section } from '@/components/marketing/Section';
import { Button } from '@/components/ui/Button';
import { formatPostDate, getAllPosts, getPost } from '@/lib/news';
import { siteConfig } from '@/lib/site-config';

interface PageProps {
  params: Promise<{ slug: string }>;
}

// Posts come from content/news at build time; anything else is a 404.
export const dynamicParams = false;

export function generateStaticParams() {
  return getAllPosts().map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const post = getPost(slug);
  if (!post) return {};
  const url = `${siteConfig.url}/news/${post.slug}`;
  return {
    title: post.title,
    description: post.description,
    alternates: { canonical: url },
    openGraph: {
      type: 'article',
      url,
      siteName: siteConfig.name,
      title: post.title,
      description: post.description,
      publishedTime: post.date,
      authors: [siteConfig.captain.fullName],
      // Setting openGraph here drops the root opengraph-image, so posts
      // without a photo point at it explicitly.
      images: [
        post.image
          ? { url: post.image, alt: post.imageAlt }
          : { url: '/opengraph-image', alt: siteConfig.name },
      ],
    },
  };
}

export default async function NewsPostPage({ params }: PageProps) {
  const { slug } = await params;
  const post = getPost(slug);
  if (!post) notFound();

  const url = `${siteConfig.url}/news/${post.slug}`;
  const more = getAllPosts()
    .filter((p) => p.slug !== post.slug)
    .slice(0, 3);

  const blogPostingJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    description: post.description,
    datePublished: post.date,
    image: [post.image ? `${siteConfig.url}${post.image}` : `${siteConfig.url}/opengraph-image`],
    url,
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
    author: {
      '@type': 'Person',
      name: siteConfig.captain.fullName,
      url: `${siteConfig.url}/about#captain`,
    },
    publisher: {
      '@type': 'Organization',
      name: siteConfig.name,
      url: siteConfig.url,
    },
  };

  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: siteConfig.url },
      { '@type': 'ListItem', position: 2, name: 'News', item: `${siteConfig.url}/news` },
      { '@type': 'ListItem', position: 3, name: post.title, item: url },
    ],
  };

  return (
    <>
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(blogPostingJsonLd) }}
      />
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />

      <Section tone="cream" size="md">
        <nav aria-label="Breadcrumb" className="mb-6 text-sm">
          <ol className="flex flex-wrap items-center gap-2 text-[var(--color-ink-soft)]">
            <li>
              <Link href="/" className="hover:text-[var(--color-brand-blue)]">
                Home
              </Link>
            </li>
            <li aria-hidden>/</li>
            <li>
              <Link href="/news" className="hover:text-[var(--color-brand-blue)]">
                News
              </Link>
            </li>
            <li aria-hidden>/</li>
            <li aria-current="page" className="text-[var(--color-ink)]">
              {post.title}
            </li>
          </ol>
        </nav>
        <div className="max-w-3xl">
          <p className="text-xs sm:text-sm font-medium uppercase tracking-[0.2em] text-[var(--color-coral-dark)]">
            <time dateTime={post.date}>{formatPostDate(post.date)}</time>
            <span aria-hidden className="mx-2 text-[var(--color-ink)]/30">·</span>
            {siteConfig.captain.fullName}
          </p>
          <h1 className="mt-4 font-display text-4xl sm:text-5xl lg:text-6xl leading-[1.05]">
            {post.title}
          </h1>
        </div>
      </Section>

      <Section tone="white" size="md">
        <article
          className="news-body max-w-3xl"
          // Rendered from our own Markdown files in content/news.
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: post.html }}
        />
      </Section>

      <Section tone="blue" size="md">
        <div className="text-center max-w-xl mx-auto">
          <h2 className="font-display text-3xl sm:text-4xl text-white leading-tight">
            Swim with them yourself.
          </h2>
          <p className="mt-4 text-white/85">
            Shared and private manatee tours on Kings Bay, six guests at
            most, with Capt. Travis in the water alongside you.
          </p>
          <div className="mt-6 flex justify-center gap-3 flex-wrap">
            <Link
              href="/tours"
              className="inline-flex items-center px-6 py-3.5 rounded-full bg-white text-[var(--color-brand-blue)] font-medium"
            >
              See the tours
            </Link>
            <Button href="/book" variant="ghost" className="!text-white hover:!bg-white/10">
              Book a tour
            </Button>
          </div>
        </div>
      </Section>

      {more.length > 0 && (
        <Section tone="cream" size="md">
          <h2 className="font-display text-2xl sm:text-3xl mb-6">More from the river</h2>
          <ul className="grid gap-4 sm:grid-cols-3">
            {more.map((p) => (
              <li key={p.slug}>
                <Link
                  href={`/news/${p.slug}`}
                  className="group block h-full rounded-2xl bg-white border border-[var(--color-ink)]/8 p-5 shadow-[var(--shadow-card)] hover:shadow-[var(--shadow-soft)] transition-shadow"
                >
                  <time
                    dateTime={p.date}
                    className="text-xs font-medium uppercase tracking-[0.14em] text-[var(--color-ink-soft)]"
                  >
                    {formatPostDate(p.date)}
                  </time>
                  <p className="mt-2 font-display text-lg leading-snug group-hover:text-[var(--color-brand-blue)] transition-colors">
                    {p.title}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </>
  );
}

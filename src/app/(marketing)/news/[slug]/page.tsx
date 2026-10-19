import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { NewsArticle } from '@/components/marketing/NewsArticle';
import { Container, Section } from '@/components/marketing/Section';
import { ArrowRight } from '@/components/ui/icons';
import { Button } from '@/components/ui/Button';
import { absoluteImageUrl, formatPostDate, getAllPosts, getPost } from '@/lib/news';
import { siteConfig } from '@/lib/site-config';
import { pageSeo, jsonLdHtml } from '@/lib/seo';

interface PageProps {
  params: Promise<{ slug: string }>;
}

// Markdown posts are built ahead; grokbot's posts (Firestore) render on
// first visit. Like every marketing page they regenerate every minute, and
// right away when grokbot publishes or a post is hidden (revalidateNews).
// An unknown or hidden slug gets the not-found page with `noindex`, but
// status 200: the group's loading.tsx has started the response by then.
export async function generateStaticParams() {
  return (await getAllPosts()).map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const post = await getPost(slug);
  if (!post) return {};
  return {
    // Grokbot posts carry a full SEO title, checked for length on publish.
    title: post.seoTitle ? { absolute: post.seoTitle } : post.title,
    description: post.description,
    ...pageSeo(`/news/${post.slug}`, {
      type: 'article',
      title: post.seoTitle ?? post.title,
      description: post.description,
      publishedTime: post.date,
      modifiedTime: post.modified,
      authors: [siteConfig.captain.fullName],
      // Posts without a photo keep the default site card.
      ...(post.hero
        ? { images: [{ url: post.hero.url, width: post.hero.width, height: post.hero.height, alt: post.hero.alt }] }
        : post.image && { images: [{ url: post.image, alt: post.imageAlt }] }),
    }),
  };
}

export default async function NewsPostPage({ params }: PageProps) {
  const { slug } = await params;
  const post = await getPost(slug);
  if (!post) notFound();

  const url = `${siteConfig.url}/news/${post.slug}`;
  const more = (await getAllPosts())
    .filter((p) => p.slug !== post.slug)
    .slice(0, 3);

  const images = post.heroCrops.length
    ? post.heroCrops.map((i) => ({ '@type': 'ImageObject', url: i.url, width: i.width, height: i.height }))
    : [post.image ? absoluteImageUrl(post.image, siteConfig.url) : `${siteConfig.url}/opengraph-image`];

  const blogPostingJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    description: post.description,
    datePublished: post.date,
    dateModified: post.modified,
    image: images,
    url,
    inLanguage: 'en-US',
    wordCount: post.wordCount,
    ...(post.focusKeyphrase && { keywords: post.focusKeyphrase }),
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
    author: {
      '@type': 'Person',
      name: siteConfig.captain.fullName,
      url: `${siteConfig.url}/about#captain`,
      sameAs: [siteConfig.captain.instagram, siteConfig.captain.facebook],
    },
    publisher: {
      '@type': 'Organization',
      '@id': `${siteConfig.url}/#business`,
      name: siteConfig.name,
      url: siteConfig.url,
      logo: { '@type': 'ImageObject', url: `${siteConfig.url}/apple-icon` },
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
        dangerouslySetInnerHTML={{ __html: jsonLdHtml(blogPostingJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdHtml(breadcrumbJsonLd) }}
      />

      <NewsArticle post={post} />

      <section className="bg-[var(--color-spring-deep)] text-white">
        <Container size="prose" className="py-16 sm:py-20">
          <h2 className="text-display text-[2.1rem] sm:text-5xl">Swim with them yourself.</h2>
          <p className="mt-4 text-lg text-white/75">
            Shared and private manatee tours on Kings Bay, six guests at most,
            with Capt. Travis in the water alongside you.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button href="/book" size="lg">
              Check availability
              <ArrowRight size={18} />
            </Button>
            <Button href="/tours" size="lg" variant="glass">
              See the tours
            </Button>
          </div>
        </Container>
      </section>

      {more.length > 0 && (
        <Section tone="paper" size="md">
          <h2 className="text-display text-[1.75rem] sm:text-[2.25rem]">More from the river</h2>
          <ul className="mt-8 grid gap-4 sm:grid-cols-3">
            {more.map((p) => (
              <li key={p.slug}>
                <Link
                  href={`/news/${p.slug}`}
                  className="group block h-full rounded-xl border border-[var(--color-sand)] bg-white p-6 transition-colors hover:border-[var(--color-ink)]"
                >
                  <time dateTime={p.date} className="text-sm text-[var(--color-ink-soft)]">
                    {formatPostDate(p.date)}
                  </time>
                  <p className="mt-2 text-lg font-bold leading-snug">{p.title}</p>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </>
  );
}

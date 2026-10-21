import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { NewsArticle } from '@/components/marketing/NewsArticle';
import { Section } from '@/components/marketing/Section';
import { reviewTokenMatches } from '@/lib/blog-publish';
import { getAdminUser } from '@/lib/firebase/auth-server';
import type { NewsPostStatus } from '@/lib/firebase/types';
import { getPostDoc } from '@/lib/news';
import { ReviewActions } from './ReviewActions';

/**
 * /blog-review/<slug>?t=<token> — where Travis reads a grokbot draft before
 * it goes on the site, from the link in the review email (or Admin → Blog).
 * Opening it changes nothing: email scanners follow links, so approving
 * takes a tap on the page. Never indexed; the token stays out of referrers
 * (next.config.ts).
 */

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Review a blog post',
  robots: { index: false, follow: false },
};

interface PageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ t?: string }>;
}

const DONE: Record<Exclude<NewsPostStatus, 'pending-review'>, string> = {
  published: 'This post has been approved and is on the website.',
  hidden: 'This post was approved, then taken off the website in Admin → Blog.',
  declined: 'This draft was turned down, so it won’t go on the website.',
  expired: 'This draft wasn’t reviewed within a week, so Grokbot wrote a newer one. Look for that email instead.',
};

export default async function BlogReviewPage({ params, searchParams }: PageProps) {
  const [{ slug }, { t }] = await Promise.all([params, searchParams]);
  const [found, admin] = await Promise.all([
    /^[a-z0-9-]{1,80}$/.test(slug) ? getPostDoc(slug) : null,
    getAdminUser(),
  ]);

  if (!found || found.doc.status !== 'pending-review') {
    return (
      <Notice title={found ? DONE[found.doc.status as keyof typeof DONE] : 'There’s no blog post here.'}>
        {found?.doc.status === 'published' && (
          <Link href={`/news/${slug}`} className="font-semibold text-[var(--color-spring)] underline underline-offset-2">
            See the live post
          </Link>
        )}
      </Notice>
    );
  }
  if (!admin && !reviewTokenMatches(found.doc, t)) {
    return (
      <Notice title="This review link isn’t valid.">
        Open the newest review email, or{' '}
        <Link href="/admin/blog" className="font-semibold text-[var(--color-spring)] underline underline-offset-2">
          Admin → Blog
        </Link>
        .
      </Notice>
    );
  }

  const { post, doc } = found;
  return (
    <>
      <Section tone="paper" size="sm" container="prose" className="!pb-0">
        <div className="rounded-2xl border border-[var(--color-buoy)]/40 bg-[var(--color-buoy)]/10 p-5">
          <p className="font-bold">Draft for your review. It isn’t on the website yet.</p>
          <p className="mt-1 text-sm text-[var(--color-ink-soft)]">
            Grokbot wrote this for the News page. Read it through, then approve it or say what to change at the
            bottom.
          </p>
          <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <span>SEO score <strong>{doc.seoScore}</strong></span>
            <span>Readability <strong>{doc.readabilityScore}</strong></span>
            <span><strong>{doc.wordCount}</strong> words</span>
            <span>Search phrase: <strong>{doc.focusKeyphrase}</strong></span>
          </p>
          <p className="mt-2 text-sm text-[var(--color-ink-soft)]">
            In Google it shows as <strong className="text-[var(--color-ink)]">{doc.seoTitle}</strong> — {doc.description}
          </p>
        </div>
      </Section>

      <NewsArticle post={post} />

      <Section tone="paper" size="sm" container="prose" className="!pt-0 pb-20">
        <ReviewActions slug={slug} token={admin ? null : (t ?? null)} submittedAt={doc.submittedAt.toMillis()} />
      </Section>
    </>
  );
}

function Notice({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <Section tone="paper" size="md" container="prose">
      <h1 className="text-display text-[2rem] sm:text-[2.5rem]">{title}</h1>
      {children && <p className="mt-4 text-lg">{children}</p>}
    </Section>
  );
}

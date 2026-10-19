import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { BlogAdmin, type BlogRow } from '@/components/admin/BlogAdmin';
import { AdminPageHeader } from '@/components/admin/ui';
import { blogCadence, CADENCE_DAYS } from '@/lib/blog-publish';
import { adminDb } from '@/lib/firebase/admin';
import type { NewsPostDoc } from '@/lib/firebase/types';
import { serviceAccountEmail } from '@/lib/google-drive';
import { hostFromHeaders } from '@/lib/host';
import { blogKey, mcpToken } from '@/lib/mcp/http';

export const metadata: Metadata = {
  title: 'Blog — Admin',
  robots: { index: false, follow: false },
};

export default async function BlogPage() {
  const [snap, cadence, shareWith, requestHeaders] = await Promise.all([
    adminDb().collection('newsPosts').get(),
    blogCadence(),
    serviceAccountEmail(),
    headers(),
  ]);
  // The connector URL for grokbot, on whichever address admin is open on.
  const host = hostFromHeaders(requestHeaders);
  const token = mcpToken();
  const connectorUrl = token
    ? `${host.startsWith('localhost') ? 'http' : 'https'}://${host}/api/mcp/blog?key=${blogKey(token)}`
    : null;
  const rows: BlogRow[] = snap.docs
    .map((d) => d.data() as NewsPostDoc)
    .sort((a, b) => b.submittedAt.toMillis() - a.submittedAt.toMillis())
    .map((p) => ({
      slug: p.slug,
      title: p.title,
      description: p.description,
      focusKeyphrase: p.focusKeyphrase,
      submittedAt: p.submittedAt.toDate().toISOString(),
      publishedAt: p.publishedAt?.toDate().toISOString() ?? null,
      status: p.status,
      reviewNote: p.reviewNote ?? null,
      seoScore: p.seoScore,
      readabilityScore: p.readabilityScore,
      wordCount: p.wordCount,
      thumbnail: p.hero.url,
      thumbnailAlt: p.hero.alt,
    }));

  return (
    <div className="max-w-5xl mx-auto">
      <AdminPageHeader
        title="Blog"
        description={
          <>
            Grokbot writes a post for the News page every {CADENCE_DAYS} days,
            using photos from your Google Drive, and checks it the way Yoast
            did on the old site. Each one comes to you by email first: it only
            goes on the website when you approve it. You can still take a
            post down here later.
          </>
        }
      />
      <BlogAdmin
        rows={rows}
        nextDueAt={cadence.nextDueAt}
        waitingForReview={cadence.pending !== null}
        shareWith={shareWith}
        connectorUrl={connectorUrl}
      />
    </div>
  );
}

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
    adminDb().collection('newsPosts').orderBy('publishedAt', 'desc').get(),
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
  const rows: BlogRow[] = snap.docs.map((d) => {
    const p = d.data() as NewsPostDoc;
    return {
      slug: p.slug,
      title: p.title,
      description: p.description,
      focusKeyphrase: p.focusKeyphrase,
      publishedAt: p.publishedAt.toDate().toISOString(),
      status: p.status,
      seoScore: p.seoScore,
      readabilityScore: p.readabilityScore,
      wordCount: p.wordCount,
      thumbnail: p.hero.url,
      thumbnailAlt: p.hero.alt,
    };
  });

  return (
    <div className="max-w-5xl mx-auto">
      <AdminPageHeader
        title="Blog"
        description={
          <>
            Grokbot writes a post for the News page every {CADENCE_DAYS} days,
            using photos from your Google Drive. A post only goes live once it
            passes the same kind of SEO and readability check Yoast ran on the
            old site, and you get an email with the link. If anything in a
            post is wrong, hide it here: it comes off the website right away.
          </>
        }
      />
      <BlogAdmin rows={rows} nextDueAt={cadence.nextDueAt} shareWith={shareWith} connectorUrl={connectorUrl} />
    </div>
  );
}

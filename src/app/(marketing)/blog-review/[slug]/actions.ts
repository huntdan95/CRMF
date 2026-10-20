'use server';

import { reviewPost, reviewTokenMatches, type ReviewResult } from '@/lib/blog-publish';
import { getAdminUser } from '@/lib/firebase/auth-server';
import { getPostDoc } from '@/lib/news';

/**
 * Approve or turn down a grokbot draft, from the review page. Allowed with
 * the token from the review email, or when signed in to admin.
 * `submittedAt` is the draft the page showed (see reviewPost).
 */
export async function reviewDraft(
  slug: string,
  token: string | null,
  submittedAt: number,
  decision: 'approve' | 'decline',
  note?: string,
): Promise<ReviewResult> {
  if (
    !/^[a-z0-9-]{1,80}$/.test(slug) ||
    !Number.isFinite(submittedAt) ||
    (decision !== 'approve' && decision !== 'decline')
  ) {
    return { ok: false, error: 'That isn’t a blog post.' };
  }
  const [found, admin] = await Promise.all([getPostDoc(slug), getAdminUser()]);
  if (!found) return { ok: false, error: 'That post no longer exists.' };
  if (!admin && !reviewTokenMatches(found.doc, token)) {
    return { ok: false, error: 'This review link has already been used or isn’t valid. Open Admin → Blog instead.' };
  }
  return reviewPost(
    slug,
    submittedAt,
    decision,
    admin
      ? { email: admin.email, method: 'admin' }
      : { email: process.env.NEXT_PUBLIC_ADMIN_EMAIL ?? 'travis', method: 'email link' },
    note,
  );
}

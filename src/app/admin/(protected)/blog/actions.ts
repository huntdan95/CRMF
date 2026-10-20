'use server';

import { revalidatePath } from 'next/cache';
import { FieldValue } from 'firebase-admin/firestore';
import { deleteWithdrawnCopies, hasWithdrawnPhoto, revalidateNews } from '@/lib/blog-publish';
import { adminDb } from '@/lib/firebase/admin';
import { getAdminUser } from '@/lib/firebase/auth-server';

/**
 * Takes an approved grokbot post off the website, or puts it back. The page
 * is regenerated straight away, so a hidden post is gone within seconds.
 */
export async function setPostStatus(
  slug: string,
  status: 'published' | 'hidden',
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await getAdminUser();
  if (!user) return { ok: false, error: 'Your admin session has ended. Sign in again.' };
  if (!/^[a-z0-9-]{1,80}$/.test(slug) || (status !== 'published' && status !== 'hidden')) {
    return { ok: false, error: 'That isn’t a blog post.' };
  }

  const db = adminDb();
  const ref = db.collection('newsPosts').doc(slug);
  const snap = await ref.get();
  if (!snap.exists) return { ok: false, error: 'That post no longer exists.' };
  const before = snap.get('status') as string;
  if (before === status) return { ok: true };
  // Only approved posts go up and down here; drafts are approved on the review page.
  if (before !== 'published' && before !== 'hidden') {
    return { ok: false, error: 'That post hasn’t been approved. Review it first.' };
  }

  // A photo Travis deleted from Trip photos (a guest asked) stays on the
  // post's own copy; it doesn't go back on the website with it.
  if (status === 'published' && (await hasWithdrawnPhoto((snap.get('photoIds') as string[] | undefined) ?? []))) {
    return {
      ok: false,
      error: 'One of this post’s photos was deleted from Trip photos, so it can’t go back on the website with it.',
    };
  }

  await ref.update({ status });
  // Off the website, its copy of a photo deleted from Trip photos goes
  // too: the image's address would still work otherwise.
  const photosDeleted = status === 'hidden' ? await deleteWithdrawnCopies(slug) : 0;
  await db.collection('auditLog').add({
    action: status === 'hidden' ? 'post.hide' : 'post.show',
    actorEmail: user.email,
    targetId: `newsPost/${slug}`,
    payload: { title: snap.get('title') as string, before, after: status, ...(photosDeleted > 0 && { photosDeleted }) },
    createdAt: FieldValue.serverTimestamp(),
  });
  revalidateNews(slug);
  revalidatePath('/admin/blog');
  return { ok: true };
}

import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions/v2';
import type { DocumentReference } from 'firebase-admin/firestore';

import { RESEND_API_KEY, RESEND_FROM_EMAIL } from './lib/resend';
import { sendEmail, type EmailDeps } from './lib/email-log';
import { ADMIN_EMAIL, APP_BASE_URL } from './lib/config';
import { COLORS, actions, button, card, emailPage, escape, heading, label, para } from './lib/email-layout';

/**
 * Firestore trigger: grokbot submitted a blog post. The site wrote a new
 * `blogReviewRequests` doc with the post rendered for email and the review
 * link's token; this sends Travis the whole post with a button to the
 * review page, where he approves it or says what to change. Nothing goes on
 * the website until he does.
 */
export const onBlogReviewRequested = onDocumentCreated(
  {
    // `{slug}` as first deployed, so a deploy doesn't change the trigger. A
    // request isn't always named after its slug any more (one made while an
    // earlier one's failed email is still there gets an id of its own), so
    // the slug is read from the request; the param is only a fallback.
    document: 'blogReviewRequests/{slug}',
    region: 'us-central1',
    secrets: [RESEND_API_KEY, RESEND_FROM_EMAIL, APP_BASE_URL],
    retry: false,
    maxInstances: 2,
  },
  async (event) => {
    if (!event.data) {
      logger.warn('blogReviewRequests trigger fired with no data');
      return;
    }
    const r = event.data.data() as BlogReviewRequest;
    await sendBlogReview(event.data.ref, { ...r, slug: r.slug || event.params.slug });
  },
);

/** What the site writes in a review request (submitPost in src/lib/blog-publish.ts). */
export interface BlogReviewRequest {
  slug?: string;
  title?: string;
  seoTitle?: string;
  description?: string;
  focusKeyphrase?: string;
  hero?: { url: string; alt: string };
  bodyHtml?: string;
  token?: string;
  seoScore?: number;
  readabilityScore?: number;
  wordCount?: number;
}

/**
 * Emails Travis one review request. The request holds the only copy of the
 * review link's token: it's deleted once the email is sent, and kept, with
 * the error, if Resend refuses it.
 */
export async function sendBlogReview(ref: DocumentReference, r: BlogReviewRequest, deps: EmailDeps = {}): Promise<void> {
  const slug = r.slug;
  if (!r.token || !r.title || !slug) {
    logger.warn('blogReviewRequests doc missing token, title or slug', { id: ref.id });
    return;
  }
  // The site's own address: the staging URL until the domain moves.
  const base = (APP_BASE_URL.value() || 'https://crystalrivermanateefun.com').replace(/\/$/, '');
  const reviewUrl = `${base}/blog-review/${slug}?t=${encodeURIComponent(r.token)}`;
  // Site links in the post are relative; make them work from an inbox.
  const body = (r.bodyHtml ?? '').replace(/href="\//g, `href="${base}/`);

  const review = actions(button(reviewUrl, 'Review and approve'));
  const html = emailPage({
    title: `Blog post to review: ${r.title}`,
    preheader: 'Grokbot wrote a new blog post. It isn’t on the website until you approve it.',
    body: [
      heading('A blog post to review'),
      para(
        'Grokbot wrote this for the News page. It isn’t on the website yet. If you’re happy with it, tap ' +
          '<strong>Review and approve</strong>, then <strong>Approve &amp; publish</strong>. If not, choose ' +
          '<strong>Don’t publish</strong> and say what to change: Grokbot reads your note before it writes the next one.',
      ),
      review,
      card(
        label('In Google') +
          `<p style="margin:0 0 4px;font-size:17px;line-height:1.3;color:#1A0DAB;">${escape(r.seoTitle ?? r.title)}</p>` +
          para(escape(r.description ?? ''), { small: true, margin: '0 0 8px' }) +
          para(
            `Search phrase: ${escape(r.focusKeyphrase ?? '—')} · SEO ${r.seoScore ?? '—'}/100 · ` +
              `Readability ${r.readabilityScore ?? '—'}/100 · ${r.wordCount ?? '—'} words`,
            { soft: true, small: true, margin: '0' },
          ),
      ),
      card(
        `<h2 style="margin:0 0 16px;font-size:26px;line-height:1.15;font-weight:800;color:${COLORS.ink};">${escape(r.title)}</h2>` +
          (r.hero
            ? `<img src="${escape(r.hero.url)}" alt="${escape(r.hero.alt)}" width="556" style="display:block;width:100%;max-width:556px;height:auto;border-radius:12px;margin:0 0 18px;">`
            : '') +
          `<div style="font-size:16px;line-height:1.65;color:${COLORS.ink};">${body}</div>`,
      ),
      para('Nothing goes on the website until you approve it.', { soft: true }),
      review,
    ].join('\n'),
  });

  const text = [
    'Grokbot wrote a new blog post. It is not on the website yet.',
    '',
    r.title,
    r.description ?? '',
    '',
    'Read it and approve it (or say what to change) here:',
    reviewUrl,
  ].join('\n');

  try {
    // Throws when Resend refuses it.
    await sendEmail(
      {
        kind: 'admin',
        to: ADMIN_EMAIL.value(),
        subject: `[crmf] Blog post to review: ${r.title}`,
        text,
        html,
        headers: { 'X-Entity-Ref-ID': `blog-review-${slug}` },
      },
      deps,
    );
  } catch (err) {
    logger.error('Failed to send blog review email', { slug, err });
    await ref.update({ error: String(err) }).catch(() => undefined);
    return;
  }
  // The token isn't needed once sent.
  await ref.delete().catch((err) => logger.warn('Blog review email sent but its request not deleted', { slug, err }));
  logger.info('Blog review email sent', { slug });
}

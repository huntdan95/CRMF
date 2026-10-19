import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions/v2';

import {
  RESEND_API_KEY,
  RESEND_FROM_EMAIL,
  getResend,
  getFromAddress,
} from './lib/resend';
import { ADMIN_EMAIL, APP_BASE_URL } from './lib/config';

/**
 * Firestore trigger: grokbot submitted a blog post. The site wrote
 * `blogReviewRequests/{slug}` with the post rendered for email and the
 * review link's token; this sends Travis the whole post with a button to
 * the review page, where he approves it or says what to change. Nothing
 * goes on the website until he does. The request is deleted once sent.
 */
export const onBlogReviewRequested = onDocumentCreated(
  {
    document: 'blogReviewRequests/{slug}',
    region: 'us-central1',
    secrets: [RESEND_API_KEY, RESEND_FROM_EMAIL, APP_BASE_URL],
    retry: false,
    maxInstances: 2,
  },
  async (event) => {
    const data = event.data?.data();
    if (!data) {
      logger.warn('blogReviewRequests trigger fired with no data');
      return;
    }
    const r = data as {
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
    };
    const slug = event.params.slug;
    if (!r.token || !r.title) {
      logger.warn('blogReviewRequests doc missing token or title', { slug });
      return;
    }
    // The site's own address: the staging URL until the domain moves.
    const base = (APP_BASE_URL.value() || 'https://crystalrivermanateefun.com').replace(/\/$/, '');
    const reviewUrl = `${base}/blog-review/${slug}?t=${encodeURIComponent(r.token)}`;
    // Site links in the post are relative; make them work from an inbox.
    const body = (r.bodyHtml ?? '').replace(/href="\//g, `href="${base}/`);

    const button = `<a href="${escape(reviewUrl)}" style="display:inline-block;background:#F28C28;color:#0E201E;font-weight:700;text-decoration:none;padding:14px 22px;border-radius:10px;font-size:16px;">Review and approve</a>`;

    const html = `<!doctype html>
<html><body style="font-family:-apple-system,Segoe UI,sans-serif;background:#F5EDD8;color:#1A1F1B;padding:24px;margin:0;">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;padding:28px;">
    <p style="margin:0 0 6px;font-size:13px;color:#7A8B7E;">New blog post from Grokbot · not on the website yet</p>
    <p style="margin:0 0 18px;font-size:15px;line-height:1.6;">
      Have a read. If you're happy with it, tap <strong>Review and approve</strong> and then
      <strong>Approve &amp; publish</strong>. If not, choose <strong>Don't publish</strong> and say
      what to change; Grokbot reads your note before it writes the next one.
    </p>
    <p style="margin:0 0 24px;">${button}</p>

    <div style="border:1px solid #E4DCC6;border-radius:10px;padding:14px 16px;margin:0 0 24px;font-size:13px;line-height:1.5;color:#45524A;">
      In Google: <strong style="color:#1A0DAB;">${escape(r.seoTitle ?? r.title)}</strong><br>
      ${escape(r.description ?? '')}<br>
      <span style="color:#7A8B7E;">Search phrase: ${escape(r.focusKeyphrase ?? '—')} · SEO ${r.seoScore ?? '—'}/100 · Readability ${r.readabilityScore ?? '—'}/100 · ${r.wordCount ?? '—'} words</span>
    </div>

    <h1 style="font-family:Georgia,serif;font-size:28px;line-height:1.25;margin:0 0 16px;color:#0E201E;">${escape(r.title)}</h1>
    ${r.hero ? `<img src="${escape(r.hero.url)}" alt="${escape(r.hero.alt)}" width="544" style="display:block;width:100%;max-width:544px;height:auto;border-radius:8px;margin:0 0 20px;">` : ''}
    <div style="font-size:16px;line-height:1.65;">${body}</div>

    <hr style="border:none;border-top:1px solid #E4DCC6;margin:28px 0;">
    <p style="margin:0 0 12px;font-size:15px;">Nothing goes on the website until you approve it.</p>
    <p style="margin:0;">${button}</p>
  </div>
</body></html>`;

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
      await getResend().emails.send({
        from: getFromAddress(),
        to: [ADMIN_EMAIL.value()],
        subject: `[crmf] Blog post to review: ${r.title}`,
        text,
        html,
        headers: { 'X-Entity-Ref-ID': `blog-review-${slug}` },
      });
      // The request holds the review token; it isn't needed once sent.
      await event.data?.ref.delete();
      logger.info('Blog review email sent', { slug });
    } catch (err) {
      logger.error('Failed to send blog review email', { slug, err });
      await event.data?.ref.update({ error: String(err) }).catch(() => undefined);
    }
  },
);

function escape(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

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
 * Firestore trigger: grokbot published a blog post (`newsPosts/{slug}`,
 * written by the site's MCP endpoint). Emails Travis the link so he can
 * read it, and hide it in Admin → Blog if anything's wrong.
 */
export const onNewsPostPublished = onDocumentCreated(
  {
    document: 'newsPosts/{slug}',
    region: 'us-central1',
    secrets: [RESEND_API_KEY, RESEND_FROM_EMAIL, APP_BASE_URL],
    retry: false,
    maxInstances: 2,
  },
  async (event) => {
    const data = event.data?.data();
    if (!data) {
      logger.warn('newsPosts trigger fired with no data');
      return;
    }
    const { title, description, focusKeyphrase, seoScore, readabilityScore, wordCount } = data as {
      title?: string;
      description?: string;
      focusKeyphrase?: string;
      seoScore?: number;
      readabilityScore?: number;
      wordCount?: number;
    };
    const slug = event.params.slug;
    const base = (APP_BASE_URL.value() || 'https://crystalrivermanateefun.com').replace(/\/$/, '');
    const url = `${base}/news/${slug}`;
    const adminUrl = `${base}/admin/blog`;

    try {
      const text = [
        `Grokbot published a new blog post on the website:`,
        '',
        title ?? slug,
        url,
        '',
        description ?? '',
        '',
        `Keyphrase: ${focusKeyphrase ?? '—'}`,
        `SEO score: ${seoScore ?? '—'}/100 · Readability: ${readabilityScore ?? '—'}/100 · ${wordCount ?? '—'} words`,
        '',
        `Give it a read. If anything's wrong, hide it here and it comes off the site right away:`,
        adminUrl,
      ].join('\n');

      const html = `<!doctype html>
<html><body style="font-family:-apple-system,Segoe UI,sans-serif;background:#F5EDD8;color:#1A1F1B;padding:24px;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:24px;">
    <p style="margin:0 0 8px;font-size:13px;color:#7A8B7E;">Grokbot published a new blog post</p>
    <h2 style="font-family:'Fraunces',Georgia,serif;color:#1B6FA8;margin:0 0 12px;">
      <a href="${escape(url)}" style="color:#1B6FA8;">${escape(title ?? slug)}</a>
    </h2>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">${escape(description ?? '')}</p>
    <p style="margin:0 0 16px;font-size:13px;color:#7A8B7E;">
      Keyphrase: ${escape(focusKeyphrase ?? '—')}<br>
      SEO score ${seoScore ?? '—'}/100 · Readability ${readabilityScore ?? '—'}/100 · ${wordCount ?? '—'} words
    </p>
    <p style="margin:0;font-size:14px;line-height:1.6;">
      <a href="${escape(url)}" style="color:#1B6FA8;">Read the post</a>.
      If anything in it is wrong, <a href="${escape(adminUrl)}" style="color:#1B6FA8;">hide it in Admin → Blog</a>
      and it comes off the website right away.
    </p>
  </div>
</body></html>`;

      await getResend().emails.send({
        from: getFromAddress(),
        to: [ADMIN_EMAIL.value()],
        subject: `[crmf] New blog post: ${title ?? slug}`,
        text,
        html,
        headers: { 'X-Entity-Ref-ID': `newsPost-${slug}` },
      });
      logger.info('Blog post notification sent', { slug });
    } catch (err) {
      logger.error('Failed to send blog post notification', { slug, err });
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

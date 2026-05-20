import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions/v2';

import {
  RESEND_API_KEY,
  RESEND_FROM_EMAIL,
  getResend,
  getFromAddress,
} from './lib/resend';
import { ADMIN_EMAIL } from './lib/config';

/**
 * Firestore trigger: every new doc in `contactMessages` emails Travis.
 * The contact form's server action writes there; this listener picks it up
 * and notifies him so he doesn't have to keep checking the admin panel.
 */
export const onContactMessageCreated = onDocumentCreated(
  {
    document: 'contactMessages/{messageId}',
    region: 'us-central1',
    secrets: [RESEND_API_KEY, RESEND_FROM_EMAIL],
    retry: false,
    maxInstances: 5,
  },
  async (event) => {
    const data = event.data?.data();
    if (!data) {
      logger.warn('contactMessages trigger fired with no data');
      return;
    }

    const { name, email, phone, subject, message } = data as {
      name?: string;
      email?: string;
      phone?: string | null;
      subject?: string | null;
      message?: string;
    };

    if (!email || !name || !message) {
      logger.warn('contactMessages doc missing required fields', {
        id: event.params.messageId,
      });
      return;
    }

    try {
      const resend = getResend();
      const from = getFromAddress();
      const adminEmail = ADMIN_EMAIL.value();

      const subjectLine = subject
        ? `[crmf] ${subject} — from ${name}`
        : `[crmf] New message from ${name}`;

      const text = [
        `${name} sent a message via the contact form.`,
        '',
        `From:    ${name} <${email}>`,
        phone ? `Phone:   ${phone}` : '',
        subject ? `Subject: ${subject}` : '',
        '',
        `Message:`,
        message,
        '',
        `--`,
        `View in admin: ${process.env.APP_BASE_URL ?? 'https://crystalrivermanateefun.com'}/admin/messages`,
      ]
        .filter((line) => line !== '')
        .join('\n');

      const html = `<!doctype html>
<html><body style="font-family:-apple-system,Segoe UI,sans-serif;background:#F5EDD8;color:#1A1F1B;padding:24px;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:24px;">
    <h2 style="font-family:'Fraunces',Georgia,serif;color:#1B6FA8;margin:0 0 16px;">New contact-form message</h2>

    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      <tr>
        <td style="padding:6px 0;color:#7A8B7E;width:80px;">From</td>
        <td style="padding:6px 0;">${escape(name)} &lt;<a href="mailto:${escape(email)}" style="color:#1B6FA8;">${escape(email)}</a>&gt;</td>
      </tr>
      ${phone ? `<tr><td style="padding:6px 0;color:#7A8B7E;">Phone</td><td style="padding:6px 0;"><a href="tel:${escape(phone)}" style="color:#1B6FA8;">${escape(phone)}</a></td></tr>` : ''}
      ${subject ? `<tr><td style="padding:6px 0;color:#7A8B7E;">Subject</td><td style="padding:6px 0;">${escape(subject)}</td></tr>` : ''}
    </table>

    <h3 style="font-family:'Fraunces',Georgia,serif;margin:18px 0 8px;color:#1A1F1B;">Message</h3>
    <p style="margin:0;font-size:15px;line-height:1.6;white-space:pre-wrap;">${escape(message)}</p>

    <p style="margin-top:20px;font-size:13px;color:#7A8B7E;">
      Reply directly to this email and it will go to ${escape(name)} — the From address is set to their email.
    </p>
  </div>
</body></html>`;

      await resend.emails.send({
        from,
        to: [adminEmail],
        subject: subjectLine,
        text,
        html,
        // Reply-to the customer so Travis can just hit reply.
        replyTo: email,
        headers: {
          'X-Entity-Ref-ID': event.params.messageId,
        },
      });

      logger.info('Contact-form notification email sent', {
        messageId: event.params.messageId,
      });
    } catch (err) {
      logger.error('Failed to send contact-form notification email', {
        messageId: event.params.messageId,
        err,
      });
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

import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions/v2';

import { RESEND_API_KEY, RESEND_FROM_EMAIL } from './lib/resend';
import { sendEmail } from './lib/email-log';
import { ADMIN_EMAIL, APP_BASE_URL } from './lib/config';
import { card, details, emailPage, escape, heading, link, para, subheading } from './lib/email-layout';
import { phoneHref } from './lib/bounce-alert';

/**
 * Firestore trigger: every new doc in `contactMessages` emails Travis.
 * The contact form's server action writes there; this listener picks it up
 * and notifies him so he doesn't have to keep checking the admin panel.
 */
export const onContactMessageCreated = onDocumentCreated(
  {
    document: 'contactMessages/{messageId}',
    region: 'us-central1',
    secrets: [RESEND_API_KEY, RESEND_FROM_EMAIL, APP_BASE_URL],
    retry: false,
    maxInstances: 5,
  },
  async (event) => {
    const data = event.data?.data();
    if (!data) {
      logger.warn('contactMessages trigger fired with no data');
      return;
    }

    const { name, email, phone, subject, message, notify } = data as {
      name?: string;
      email?: string;
      phone?: string | null;
      subject?: string | null;
      message?: string;
      /** false when the form was past its hourly email limit (a flood). */
      notify?: boolean;
    };

    if (notify === false) {
      logger.warn('Contact message over the hourly email limit; saved without emailing', {
        id: event.params.messageId,
      });
      return;
    }

    if (!email || !name || !message) {
      logger.warn('contactMessages doc missing required fields', {
        id: event.params.messageId,
      });
      return;
    }

    try {
      const adminEmail = ADMIN_EMAIL.value();
      const { subject: subjectLine, text, html } = buildContactMessageEmail(
        { name, email, phone, subject, message },
        APP_BASE_URL.value(),
      );

      // Throws when Resend refuses it, so the failure is logged below.
      await sendEmail({
        kind: 'contact',
        to: adminEmail,
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

/**
 * The email to Travis for one contact-form message. The plain-text and HTML
 * parts say the same: who it's from, the message, that replying reaches the
 * sender, and the link to Messages in admin.
 */
export function buildContactMessageEmail(
  m: { name: string; email: string; phone?: string | null; subject?: string | null; message: string },
  baseUrl: string,
) {
  const { name, email, phone, subject, message } = m;
  const adminUrl = `${baseUrl}/admin/messages`;
  const tel = phone ? phoneHref(phone) : null;
  const replyNote = `Reply to this email and it goes to ${name}: the reply-to address is theirs.`;

  const subjectLine = subject
    ? `[crmf] ${subject} — from ${name}`
    : `[crmf] New message from ${name}`;

  const text = [
    `${name} sent a message via the contact form.`,
    '',
    `From:    ${name} <${email}>`,
    phone ? `Phone:   ${phone}` : null,
    subject ? `Subject: ${subject}` : null,
    '',
    `Message:`,
    message,
    '',
    `--`,
    replyNote,
    `View in admin: ${adminUrl}`,
  ]
    // Drop only the optional lines left out (null); the blank spacers stay.
    .filter((line) => line !== null)
    .join('\n');

  const html = emailPage({
    title: subjectLine,
    preheader: message.slice(0, 120),
    body: [
      heading('New contact-form message'),
      card(
        details([
          ['From', `${escape(name)}<br/>${link(`mailto:${email}`, email)}`],
          phone ? ['Phone', tel ? link(tel, phone) : escape(phone)] : null,
          subject ? ['Subject', escape(subject)] : null,
        ]),
        { table: true },
      ),
      subheading('Message'),
      card(`<p style="margin:0;font-size:16px;line-height:1.6;white-space:pre-wrap;">${escape(message)}</p>`),
      para(escape(replyNote), { soft: true, small: true }),
      para(link(adminUrl, 'View in admin'), { small: true, margin: '0' }),
    ].join('\n'),
  });

  return { subject: subjectLine, text, html };
}

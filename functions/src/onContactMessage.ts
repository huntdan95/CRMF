import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions/v2';

import { RESEND_API_KEY, RESEND_FROM_EMAIL } from './lib/resend';
import { sendEmail } from './lib/email-log';
import { ADMIN_EMAIL, APP_BASE_URL } from './lib/config';
import { card, details, emailPage, escape, heading, link, para, subheading } from './lib/email-layout';

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
      const baseUrl = APP_BASE_URL.value();

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
        `View in admin: ${baseUrl}/admin/messages`,
      ]
        .filter((line) => line !== '')
        .join('\n');

      const html = emailPage({
        title: subjectLine,
        preheader: message.slice(0, 120),
        body: [
          heading('New contact-form message'),
          card(
            details([
              ['From', `${escape(name)}<br/>${link(`mailto:${email}`, email)}`],
              phone ? ['Phone', link(`tel:${phone}`, phone)] : null,
              subject ? ['Subject', escape(subject)] : null,
            ]),
            { table: true },
          ),
          subheading('Message'),
          card(`<p style="margin:0;font-size:16px;line-height:1.6;white-space:pre-wrap;">${escape(message)}</p>`),
          para(`Reply to this email and it goes to ${escape(name)}: the reply-to address is theirs.`, { soft: true, small: true }),
        ].join('\n'),
      });

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

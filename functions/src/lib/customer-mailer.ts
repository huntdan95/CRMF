import { ADMIN_EMAIL } from './config';
import { sendEmail, type EmailDeps } from './email-log';
import type { CancellationMailer } from './admin-cancel';

const MARINA = {
  name: "Pete's Pier Marina",
  address: '1 SW First Place, Crystal River, FL 34429',
};
const PHONE_DISPLAY = '352-586-7792';

/**
 * Emails go out from the site, copied to Travis, replies to him. Pass the
 * signed-in admin's address to copy them instead (admin cancels, closing a
 * day). Each email is logged (lib/email-log.ts) as a cancellation unless the
 * caller says what it is.
 */
export function customerMailer(opts: { adminEmail?: string; deps?: EmailDeps } = {}): CancellationMailer {
  return {
    marina: MARINA,
    phoneDisplay: PHONE_DISPLAY,
    async send({ to, subject, html, text, bookingId, kind }) {
      const adminEmail = opts.adminEmail ?? ADMIN_EMAIL.value();
      // sendEmail throws when Resend refuses the email.
      await sendEmail(
        {
          kind: kind ?? 'cancellation',
          bookingId,
          to,
          bcc: adminEmail,
          subject,
          html,
          text,
          replyTo: adminEmail,
          headers: { 'X-Entity-Ref-ID': bookingId },
        },
        opts.deps,
      );
    },
  };
}

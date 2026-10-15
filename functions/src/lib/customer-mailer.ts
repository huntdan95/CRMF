import { ADMIN_EMAIL } from './config';
import { isEmailSendError, sendEmail, type EmailDeps } from './email-log';
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
    send: (msg) => sendCustomerEmail(msg, opts.adminEmail ?? ADMIN_EMAIL.value(), opts.deps),
  };
}

/**
 * The same, copied to and replying to `adminEmail` (whoever closed the
 * day, for close-a-day emails).
 */
export function customerMailerFor(adminEmail: string, deps?: EmailDeps): CancellationMailer {
  return customerMailer({ adminEmail, deps });
}

async function sendCustomerEmail(
  { to, subject, html, text, bookingId, kind, idempotencyKey }: Parameters<CancellationMailer['send']>[0],
  adminEmail: string,
  deps?: EmailDeps,
): Promise<void> {
  try {
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
        idempotencyKey,
      },
      deps,
    );
  } catch (err) {
    // The same key with a different email: this one already went out.
    if (isEmailSendError(err, 'invalid_idempotent_request')) return;
    throw err;
  }
}

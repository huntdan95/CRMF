import { getResend, getFromAddress } from './resend';
import { ADMIN_EMAIL } from './config';
import type { CancellationMailer } from './admin-cancel';

const MARINA = {
  name: "Pete's Pier Marina",
  address: '1 SW First Place, Crystal River, FL 34429',
};
const PHONE_DISPLAY = '352-586-7792';

/** Emails go out from the site, copied to Travis, replies to him. */
export function customerMailer(): CancellationMailer {
  return {
    marina: MARINA,
    phoneDisplay: PHONE_DISPLAY,
    send: (msg) => sendCustomerEmail(msg, ADMIN_EMAIL.value()),
  };
}

/**
 * The same, copied to and replying to `adminEmail` (whoever closed the
 * day, for close-a-day emails).
 */
export function customerMailerFor(adminEmail: string): CancellationMailer {
  return {
    marina: MARINA,
    phoneDisplay: PHONE_DISPLAY,
    send: (msg) => sendCustomerEmail(msg, adminEmail),
  };
}

async function sendCustomerEmail(
  { to, subject, html, text, bookingId, idempotencyKey }: Parameters<CancellationMailer['send']>[0],
  adminEmail: string,
): Promise<void> {
  // Resend reports a refused email in `error` rather than throwing.
  const { error } = await getResend().emails.send(
    {
      from: getFromAddress(),
      to: [to],
      bcc: [adminEmail],
      subject,
      html,
      text,
      replyTo: adminEmail,
      headers: { 'X-Entity-Ref-ID': bookingId },
    },
    idempotencyKey ? { idempotencyKey } : undefined,
  );
  // The same key with a different email: this one already went out.
  if (error?.name === 'invalid_idempotent_request') return;
  if (error) throw new Error(`Resend failed: ${error.message ?? 'unknown'}`);
}

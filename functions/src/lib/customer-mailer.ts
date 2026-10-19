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
    async send({ to, subject, html, text, bookingId }) {
      const adminEmail = ADMIN_EMAIL.value();
      // Resend reports a refused email in `error` rather than throwing.
      const { error } = await getResend().emails.send({
        from: getFromAddress(),
        to: [to],
        bcc: [adminEmail],
        subject,
        html,
        text,
        replyTo: adminEmail,
        headers: { 'X-Entity-Ref-ID': bookingId },
      });
      if (error) throw new Error(`Resend failed: ${error.message ?? 'unknown'}`);
    },
  };
}

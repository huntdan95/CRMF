import { logger } from 'firebase-functions/v2';
import { db, FieldValue } from './firebase';
import { isEmailSendError, sendEmail, type EmailDeps, type SendEmailInput } from './email-log';
import { APP_BASE_URL, ADMIN_EMAIL } from './config';
import { buildBookingConfirmation } from './email-templates';
import type { Booking } from './types';

const MARINA = {
  name: "Pete's Pier Marina",
  address: '1 SW First Place, Crystal River, FL 34429',
};
const PHONE_DISPLAY = '352-586-7792';

/**
 * Sends the booking-confirmation email to the customer (with Travis BCC'd).
 * Idempotent: skips if `confirmationEmailSentAt` is already set on the booking.
 */
export async function sendBookingConfirmation(bookingId: string, deps: EmailDeps = {}): Promise<void> {
  const store = deps.db ?? db;
  const ref = store.collection('bookings').doc(bookingId);
  const snap = await ref.get();
  if (!snap.exists) {
    logger.warn(`sendBookingConfirmation: booking ${bookingId} not found`);
    return;
  }
  const booking = snap.data() as Booking & {
    confirmationEmailSentAt?: unknown;
    confirmationEmailMessageId?: string | null;
  };

  if (booking.confirmationEmailSentAt) {
    logger.info(`Confirmation email already sent for ${bookingId} — skipping`);
    return;
  }

  if (booking.status !== 'confirmed') {
    logger.warn(
      `Not sending confirmation for ${bookingId} — status is ${booking.status}`,
    );
    return;
  }

  const baseUrl = APP_BASE_URL.value();
  const adminEmail = ADMIN_EMAIL.value();

  const { subject, html, text } = buildBookingConfirmation({
    booking,
    baseUrl,
    marina: MARINA,
    phoneDisplay: PHONE_DISPLAY,
  });

  const email: SendEmailInput = {
    kind: 'confirmation',
    bookingId,
    to: booking.customerEmail,
    bcc: adminEmail,
    subject,
    html,
    text,
    replyTo: adminEmail,
    headers: {
      'X-Entity-Ref-ID': bookingId,
    },
  };
  // The marker below is written after sending. If that write fails (or
  // the function dies first), stripeWebhook's retry calls this again;
  // Resend drops the repeat instead of the customer getting two emails.
  // Admin's "Resend confirmation" clears only the sent-at marker, so the
  // last message id makes each deliberate resend a new key.
  let sent: { id: string | null };
  try {
    sent = await sendEmail(
      {
        ...email,
        idempotencyKey: `booking-confirmation/${bookingId}/${booking.confirmationEmailMessageId ?? 'first'}`,
      },
      { ...deps, db: store },
    );
  } catch (err) {
    if (!isEmailSendError(err, 'invalid_idempotent_request')) {
      logger.error('Resend error sending confirmation', { bookingId, err });
      throw err;
    }
    // The booking changed since the key was used (a new email address, say),
    // so Resend won't reuse it for 24 hours. This is a different email now:
    // send it without one.
    try {
      sent = await sendEmail(email, { ...deps, db: store });
    } catch (retryErr) {
      logger.error('Resend error sending confirmation', { bookingId, err: retryErr });
      throw retryErr;
    }
  }

  await ref.update({
    confirmationEmailSentAt: FieldValue.serverTimestamp(),
    confirmationEmailMessageId: sent.id,
    updatedAt: FieldValue.serverTimestamp(),
  });

  logger.info('Confirmation email sent', { bookingId, messageId: sent.id });
}

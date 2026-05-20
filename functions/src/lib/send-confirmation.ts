import { logger } from 'firebase-functions/v2';
import { db, FieldValue } from './firebase';
import { getResend, getFromAddress } from './resend';
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
export async function sendBookingConfirmation(bookingId: string): Promise<void> {
  const ref = db.collection('bookings').doc(bookingId);
  const snap = await ref.get();
  if (!snap.exists) {
    logger.warn(`sendBookingConfirmation: booking ${bookingId} not found`);
    return;
  }
  const booking = snap.data() as Booking & { confirmationEmailSentAt?: unknown };

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

  const resend = getResend();
  const from = getFromAddress();
  const baseUrl = APP_BASE_URL.value();
  const adminEmail = ADMIN_EMAIL.value();

  const { subject, html, text } = buildBookingConfirmation({
    booking,
    baseUrl,
    marina: MARINA,
    phoneDisplay: PHONE_DISPLAY,
  });

  const { data, error } = await resend.emails.send({
    from,
    to: [booking.customerEmail],
    bcc: [adminEmail],
    subject,
    html,
    text,
    replyTo: adminEmail,
    headers: {
      'X-Entity-Ref-ID': bookingId,
    },
  });

  if (error) {
    logger.error('Resend error sending confirmation', {
      bookingId,
      error,
    });
    throw new Error(`Resend failed: ${error.message ?? 'unknown error'}`);
  }

  await ref.update({
    confirmationEmailSentAt: FieldValue.serverTimestamp(),
    confirmationEmailMessageId: data?.id ?? null,
    updatedAt: FieldValue.serverTimestamp(),
  });

  logger.info('Confirmation email sent', { bookingId, messageId: data?.id });
}

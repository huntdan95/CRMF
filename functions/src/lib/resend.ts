import { Resend } from 'resend';
import { defineSecret } from 'firebase-functions/params';

export const RESEND_API_KEY = defineSecret('RESEND_API_KEY');
export const RESEND_FROM_EMAIL = defineSecret('RESEND_FROM_EMAIL');
/**
 * Signing secret of the Resend webhook (resendWebhook.ts), the `whsec_…`
 * value Resend shows for the endpoint.
 */
export const RESEND_WEBHOOK_SECRET = defineSecret('RESEND_WEBHOOK_SECRET');

export function getResend(): Resend {
  const key = RESEND_API_KEY.value();
  if (!key) {
    throw new Error(
      'RESEND_API_KEY is not set. Run `firebase functions:secrets:set RESEND_API_KEY`.',
    );
  }
  return new Resend(key);
}

export function getFromAddress(): string {
  const from = RESEND_FROM_EMAIL.value();
  if (!from) {
    throw new Error(
      'RESEND_FROM_EMAIL is not set. Run `firebase functions:secrets:set RESEND_FROM_EMAIL`.',
    );
  }
  return from;
}

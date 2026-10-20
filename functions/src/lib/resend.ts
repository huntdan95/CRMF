import { createHash } from 'node:crypto';
import { Resend } from 'resend';
import { defineSecret } from 'firebase-functions/params';
import { db, FieldValue } from './firebase';

export const RESEND_API_KEY = defineSecret('RESEND_API_KEY');
export const RESEND_FROM_EMAIL = defineSecret('RESEND_FROM_EMAIL');
/**
 * Signing secret of the Resend webhook (resendWebhook.ts), the `whsec_…`
 * value Resend shows for the endpoint.
 */
export const RESEND_WEBHOOK_SECRET = defineSecret('RESEND_WEBHOOK_SECRET');

/** See {@link outboxResend}. */
const OUTBOX_KEY = 'emulator-outbox';

export function getResend(): Resend {
  const key = RESEND_API_KEY.value();
  if (!key) {
    throw new Error(
      'RESEND_API_KEY is not set. Run `firebase functions:secrets:set RESEND_API_KEY`.',
    );
  }
  if (key === OUTBOX_KEY && process.env.FIRESTORE_EMULATOR_HOST) {
    return outboxResend();
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

/**
 * Local testing only. With RESEND_API_KEY set to `emulator-outbox` while
 * Firestore points at the emulator, emails are written to the
 * `emailOutbox` collection instead of being sent, and a repeated
 * idempotency key is dropped the way Resend drops it. Production never
 * gets here: only the emulator sets FIRESTORE_EMULATOR_HOST.
 */
function outboxResend(): Resend {
  const send = async (
    email: Record<string, unknown>,
    options?: { idempotencyKey?: string },
  ) => {
    const ref = db.collection('emailOutbox').doc();
    const key = options?.idempotencyKey;
    const keyRef = key
      ? db.collection('emailOutboxKeys').doc(createHash('sha256').update(key).digest('hex'))
      : null;
    const id = await db.runTransaction(async (tx) => {
      if (keyRef) {
        const seen = await tx.get(keyRef);
        if (seen.exists) return seen.get('emailId') as string;
        tx.set(keyRef, { emailId: ref.id, key });
      }
      tx.set(ref, {
        ...JSON.parse(JSON.stringify(email)),
        idempotencyKey: key ?? null,
        createdAt: FieldValue.serverTimestamp(),
      });
      return ref.id;
    });
    return { data: { id }, error: null };
  };
  return { emails: { send } } as unknown as Resend;
}

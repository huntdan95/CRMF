import Stripe from 'stripe';
import { defineSecret } from 'firebase-functions/params';

export const STRIPE_SECRET_KEY = defineSecret('STRIPE_SECRET_KEY');
export const STRIPE_WEBHOOK_SECRET = defineSecret('STRIPE_WEBHOOK_SECRET');

/**
 * Lazily-initialized Stripe client. Call inside a function handler so the
 * secret is resolved at request time (not at module load).
 */
export function getStripe(): Stripe {
  const key = STRIPE_SECRET_KEY.value();
  if (!key) {
    throw new Error(
      'STRIPE_SECRET_KEY is not set. Run `firebase functions:secrets:set STRIPE_SECRET_KEY`.',
    );
  }
  // Omitting apiVersion uses the SDK-pinned default — Phase 7 polish should
  // pin this explicitly once the live Stripe account is set up.
  return new Stripe(key);
}

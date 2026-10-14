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
  //
  // The SDK's defaults (80s timeout, 2 retries) outlast a function's 60s
  // limit. A Stripe call has to give up in time for its caller to clean up:
  // createCheckoutSession frees the seats of a booking whose checkout
  // couldn't be created, and if the function were killed first, nothing
  // would ever release that hold.
  return new Stripe(key, { timeout: 15_000, maxNetworkRetries: 1 });
}

/**
 * A booking's refunded total once `refund` has gone through.
 *
 * It's Stripe's own figure, read off the refund's charge, so create or list
 * the refund with its charge expanded. stripeWebhook writes the same figure
 * when Stripe reports the refund, so it doesn't matter which lands first,
 * and neither counts the refund twice. Stripe's figure can trail ours only
 * on a retried request, whose saved response predates any refund made
 * since; the total never goes down. Without the charge, the refund is added.
 */
export function refundedTotalAfter(
  before: number,
  refund: Pick<Stripe.Refund, 'amount' | 'charge'>,
): number {
  const charge = refund.charge;
  if (charge && typeof charge === 'object') return Math.max(before, charge.amount_refunded);
  return before + refund.amount;
}

import { defineBoolean, defineSecret, defineString } from 'firebase-functions/params';

/**
 * Canonical site URL — used as success/cancel base for Stripe Checkout and
 * for the self-service link in confirmation emails.
 *
 * Set with: `firebase functions:secrets:set APP_BASE_URL`
 * or in local emulator: `firebase functions:config:set ...` (Phase 7).
 */
export const APP_BASE_URL = defineSecret('APP_BASE_URL');

/**
 * Adminstrator email — used when sending Travis copy of booking emails and
 * (eventually) for matching auth claims. Defaults at parameter level so a
 * fresh deploy still works without `firebase functions:secrets:set`.
 */
export const ADMIN_EMAIL = defineString('ADMIN_EMAIL', {
  default: 'travisurbin1@gmail.com',
});

/**
 * More Google accounts allowed into admin besides ADMIN_EMAIL,
 * comma-separated. They don't get Travis's copies of booking emails. Keep
 * in step with OTHER_ADMIN_EMAILS in apphosting.yaml and `isAdmin()` in
 * firestore.rules and storage.rules.
 */
export const OTHER_ADMIN_EMAILS = defineString('OTHER_ADMIN_EMAILS', {
  default: '',
});

/**
 * Shared secret the site's MCP endpoint (/api/mcp) sends instead of a
 * Firebase ID token. Only the admin endpoints that can't move money accept
 * it (`requireAdmin(req, { allowMcp: true })`); refunds and cancellations
 * still need Travis signed in. Same Secret Manager secret App Hosting reads.
 *
 * Set with: `firebase functions:secrets:set MCP_TOKEN`
 */
export const MCP_TOKEN = defineSecret('MCP_TOKEN');

/**
 * Off until launch day. Until the domain serves this site, bookings still
 * come in (and get cancelled) on the old one, so an automated email could
 * reach someone who cancelled there, with a link to a page that isn't live.
 * Gates the day-before reminder and, for old-site (imported) bookings, the
 * other guest emails in lib/notify.ts. New-site bookings get those anyway.
 * Turn on in functions/.env.crmf-99aad once the old bookings are re-synced.
 */
export const SEND_TOUR_REMINDERS = defineBoolean('SEND_TOUR_REMINDERS', { default: false });

/**
 * Where the Cloud Functions are deployed. Same value as the v2 region setting
 * in {@link setGlobalOptions}.
 */
export const FUNCTIONS_REGION = 'us-central1';

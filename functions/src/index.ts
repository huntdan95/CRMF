/**
 * Cloud Functions entry point.
 *
 * Each export below becomes an HTTPS function. Names match deployed URLs:
 *   https://<region>-<project>.cloudfunctions.net/<exportName>
 */

import { setGlobalOptions } from 'firebase-functions/v2';

setGlobalOptions({
  region: 'us-central1',
  maxInstances: 10,
});

export { createCheckoutSession } from './createCheckoutSession';
export { stripeWebhook } from './stripeWebhook';
export { fetchBooking } from './fetchBooking';
export { getAvailability } from './getAvailability';
export { cancelBooking } from './cancelBooking';
export { requestReschedule } from './requestReschedule';

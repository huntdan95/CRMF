// Cloud Functions entry point.
//
// Real handlers land in Phase 4 (createCheckoutSession, stripeWebhook,
// sendBookingConfirmation) and Phase 6 (admin/cancelBooking,
// admin/refundBooking, admin/rescheduleBooking).
//
// For Phase 1 we only need the file to exist so `npm run build` produces a
// valid `lib/index.js` artifact for deploy.

import { setGlobalOptions } from 'firebase-functions/v2';

setGlobalOptions({
  region: 'us-central1',
  maxInstances: 10,
});

// Placeholder export so the codebase isn't empty.
export const healthCheck = () => ({ status: 'ok' });

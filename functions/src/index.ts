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

// Public / customer-facing
export { createCheckoutSession } from './createCheckoutSession';
export { stripeWebhook } from './stripeWebhook';
export { fetchBooking } from './fetchBooking';
export { getAvailability } from './getAvailability';
export { cancelBooking } from './cancelBooking';
export { requestReschedule } from './requestReschedule';

// Admin (auth-gated, audit-logged)
export {
  adminCancelBooking,
  adminPartialRefund,
  adminEditBooking,
  adminRescheduleBooking,
  adminMarkBooking,
  adminAddNote,
  adminResendConfirmation,
} from './adminBookings';
export { adminCreateBlackout, adminDeleteBlackout } from './adminBlackouts';
export { adminUpdateTour } from './adminTours';
export { adminUpdateSettings } from './adminSettings';
export {
  adminUpdateSiteImage,
  adminDeleteSiteImage,
} from './adminSiteImages';
export {
  adminUpsertTestimonial,
  adminDeleteTestimonial,
} from './adminTestimonials';
export {
  adminUpdateContactMessage,
  adminUpdateRescheduleRequest,
} from './adminInbox';

// Firestore triggers
export { onContactMessageCreated } from './onContactMessage';

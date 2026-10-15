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
export { releaseCheckoutHold } from './releaseCheckoutHold';
export { stripeWebhook } from './stripeWebhook';
export { resendWebhook } from './resendWebhook';
export { fetchBooking } from './fetchBooking';
export { getAvailability } from './getAvailability';
export { cancelBooking } from './cancelBooking';
export { requestReschedule } from './requestReschedule';
export { moveClosedBooking } from './moveClosedBooking';

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
export {
  adminCreateBlackout,
  adminDeleteBlackout,
  adminPreviewClosure,
  adminConfirmClosure,
  adminUndoClosure,
  adminSendClosureNow,
} from './adminBlackouts';
export { adminUpdateTour } from './adminTours';
export { adminUpsertRateSeason, adminDeleteRateSeason } from './adminRateSeasons';
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

export { adminSendPostTourFollowup } from './postTourFollowup';
export { adminFixBouncedEmail } from './adminFixEmail';
export {
  adminAddCrewMember,
  adminSetCrewPassword,
  adminRemoveCrewMember,
} from './adminCrew';
export { adminSendCrewCalendarLink } from './adminCrewCalendar';

// Firestore triggers
export { onContactMessageCreated } from './onContactMessage';
export { notifyCrewOfBooking, sendCrewTestPush } from './crewNotifications';

// Scheduled jobs
export { sendPostTourFollowups } from './postTourFollowup';
export { sendTourRemindersDaily } from './tourReminders';
export { settleClosedBookings } from './settleClosedBookings';
export { finalizeClosures } from './adminBlackouts';
export { sendClosureRemindersHourly } from './closureReminders';

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
export { submitFeedback } from './feedback';

// Admin (auth-gated, audit-logged)
export {
  adminCancelBooking,
  adminPartialRefund,
  adminEditBooking,
  adminRescheduleBooking,
  adminMarkBooking,
  adminAddNote,
  adminResendConfirmation,
  adminRecordManualRefund,
  adminResetBookingLinks,
  adminEraseBooking,
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
export { adminSendWaiverReminder } from './waiverReminder';
export { adminFixBouncedEmail } from './adminFixEmail';
export { adminReviewRequest } from './reviewRequests';
export { adminDeleteTripPhoto, adminTripUploadLink } from './tripPhotos';
export {
  adminAddCrewMember,
  adminUpdateCrewMember,
  adminSeedCrew,
  adminSetCrewPassword,
  adminRemoveCrewMember,
  adminSetTripCrew,
} from './adminCrew';
export { adminSendCrewCalendarLink } from './adminCrewCalendar';

// Firestore triggers
export { onContactMessageCreated } from './onContactMessage';
export { onWaiverSigned } from './onWaiverSigned';
export { onBlogReviewRequested } from './onBlogReviewRequested';
export {
  notifyCrewOfBooking,
  notifyCrewOfSoloTrip,
  sendCrewTestPush,
} from './crewNotifications';
export {
  notifyAdminOfBooking,
  notifyAdminOfContactMessage,
  notifyAdminOfRescheduleRequest,
  notifyAdminOfFeedback,
  notifyAdminOfReviewList,
  sendAdminTestPush,
} from './adminNotifications';

// Scheduled jobs
export { sendWaiverReminders } from './waiverReminder';
export { sendTourRemindersDaily } from './tourReminders';
export { settleClosedBookings } from './settleClosedBookings';
export { finalizeClosures } from './adminBlackouts';
export { sendClosureRemindersHourly } from './closureReminders';
// Storage triggers
export { onTripPhotoUploaded } from './tripPhotos';

// Scheduled jobs (all America/New_York)
export {
  sendReviewList,
  sendReviewRequests,
  sendHeldReviewRequests,
} from './reviewRequests';
export { retryCrewAlerts } from './crewAlerts';
export { sendCrewSchedule } from './crewSchedule';
export { sendTripPrep } from './tripPrep';
export { sendDayOfDirections } from './dayOfDirections';
export { sendTripPhotos, retryDriveCopies } from './tripPhotos';
export { retryBlogReviewEmails } from './onBlogReviewRequested';

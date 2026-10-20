'use client';

import { FunctionError } from './functions-client';
import { getAdminIdToken } from './firebase/auth-client';
import type { TourTimeSlot } from './firebase/types';
import type { ClosureChoice, ClosurePreview, ClosureResult } from './closure-types';

type BlackoutReasonValue = 'weather' | 'maintenance' | 'personal' | 'other';

/** A booking a reopen or an undo put back on its trip. */
export type RestoredBookingRow = { id: string; customerName: string; date: string; timeSlot: TourTimeSlot };

function baseUrl(): string {
  const url = process.env.NEXT_PUBLIC_FUNCTIONS_BASE_URL;
  if (!url) {
    throw new Error(
      'NEXT_PUBLIC_FUNCTIONS_BASE_URL is not set. Add it to .env.local.',
    );
  }
  return url.replace(/\/$/, '');
}

async function adminCall<T>(
  name: string,
  body: Record<string, unknown>,
): Promise<T> {
  const token = await getAdminIdToken();
  const res = await fetch(`${baseUrl()}/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  if (!res.ok) {
    const message =
      parsed && typeof parsed === 'object' && 'error' in parsed && typeof parsed.error === 'string'
        ? parsed.error
        : res.statusText || `${name} failed`;
    throw new FunctionError(message, res.status, parsed);
  }
  return parsed as T;
}

// ---------------------------------------------------------------------------
// Booking actions
// ---------------------------------------------------------------------------
export const admin = {
  cancelBooking: (bookingId: string, reason: string | undefined, notifyCustomer: boolean) =>
    adminCall<{
      ok: true;
      alreadyCancelled?: boolean;
      /** Refunded through Stripe. */
      refundCents?: number;
      /** Paid on the old website: Travis refunds it himself. */
      manualRefundCents?: number;
      stripeRefundId?: string | null;
      emailed?: boolean;
      emailFailed?: boolean;
    }>('adminCancelBooking', { bookingId, reason, notifyCustomer }),
  /**
   * `requestId` is made once per refund window and sent with every try, so
   * tapping again after a dropped connection can't refund twice.
   */
  partialRefund: (bookingId: string, amountCents: number, requestId: string, reason?: string) =>
    adminCall<{ ok: true; stripeRefundId: string; refundCents: number }>(
      'adminPartialRefund',
      { bookingId, amountCents, requestId, reason },
    ),
  editBooking: (
    bookingId: string,
    patch: Partial<{
      guestCount: number;
      guests: { name: string; age: number | null; wetsuitSize: string | null }[];
      customerName: string;
      customerEmail: string;
      customerPhone: string;
      emergencyContactName: string;
      emergencyContactPhone: string;
    }>,
  ) => adminCall<{ ok: true }>('adminEditBooking', { bookingId, ...patch }),
  rescheduleBooking: (
    bookingId: string,
    newDate: string,
    newTourSlug: string,
    notifyCustomer = true,
  ) =>
    adminCall<{
      ok: true;
      /** The customer was sent their updated confirmation. */
      emailed: boolean;
      /**
       * Why not: unticked, not confirmed (an old-site reservation), no
       * address on the booking, or Resend refused it.
       */
      reason?: 'not-asked' | 'not-confirmed' | 'no-address' | 'failed';
    }>('adminRescheduleBooking', {
      bookingId,
      newDate,
      newTourSlug,
      notifyCustomer,
    }),
  markBooking: (bookingId: string, status: 'completed' | 'no-show') =>
    adminCall<{ ok: true }>('adminMarkBooking', { bookingId, status }),
  /**
   * "Refunded by hand": Travis has paid back the old-site money a
   * cancellation left owing. Records it; no money moves.
   */
  recordManualRefund: (bookingId: string) =>
    adminCall<{ ok: true; alreadyRecorded?: boolean }>('adminRecordManualRefund', { bookingId }),
  /**
   * "Reset their booking links": a new access token, so every link the
   * customer was sent stops working, and the email that fits the booking
   * (confirmation, "pick a new date", or after the trip the photos email)
   * goes to its current address with the new ones. `email` says whether it
   * went, and why not.
   */
  resetBookingLinks: (bookingId: string) =>
    adminCall<{
      ok: true;
      email:
        | { outcome: 'sent'; kind: 'confirmation' | 'closureOffer' | 'photos'; to: string }
        | { outcome: 'failed'; kind: 'confirmation' | 'closureOffer' | 'photos'; to: string; reason: string }
        | { outcome: 'skipped'; reason: string };
    }>('adminResetBookingLinks', { bookingId }),
  /**
   * Replaces the private notes. `previousNotes` is what they were when the
   * note window opened: if the site has added a line since (a refund to
   * make by hand, a customer's move), the save is refused rather than
   * writing over it.
   */
  addNote: (bookingId: string, note: string, previousNotes: string) =>
    adminCall<{ ok: true; adminNotes: string }>('adminAddNote', { bookingId, note, previousNotes }),
  resendConfirmation: (bookingId: string) =>
    adminCall<{ ok: true }>('adminResendConfirmation', { bookingId }),
  /** Save the customer's right address and send each bounced email again where possible. */
  fixBouncedEmail: (bookingId: string, customerEmail: string) =>
    adminCall<{
      ok: true;
      customerEmail: string;
      results: Array<{
        kind: string;
        label: string;
        bouncedTo: string;
        outcome: 'resent' | 'skipped' | 'failed';
        reason?: string;
        callThem?: boolean;
      }>;
    }>('adminFixBouncedEmail', { bookingId, customerEmail }),
  /** "Send now" or "Hold, I'll call them first" on Admin → Review requests. */
  reviewRequest: (bookingId: string, action: 'send' | 'hold') =>
    adminCall<{ ok: true; sent?: boolean; holdUntil?: string }>('adminReviewRequest', { bookingId, action }),
  sendPostTourFollowup: (bookingId: string, force = false) =>
    adminCall<{
      sent: boolean;
      skipped?: 'already-sent' | 'not-confirmed' | 'not-found' | 'not-yet' | 'too-old' | 'closed' | 'suppressed';
    }>('adminSendPostTourFollowup', { bookingId, force }),
  sendWaiverReminder: (bookingId: string) =>
    adminCall<{
      sent: boolean;
      skipped?: 'not-found' | 'not-confirmed' | 'closed' | 'past' | 'no-address' | 'already-sent' | 'in-progress' | 'all-signed';
    }>('adminSendWaiverReminder', { bookingId }),

  // Closing a day: review, confirm, then an undo window before anything goes out.
  previewClosure: (input: {
    date: string;
    affectedSlots: (TourTimeSlot | 'all')[];
    reason?: BlackoutReasonValue;
    notes?: string;
  }) => adminCall<{ ok: true } & ClosurePreview>('adminPreviewClosure', input),
  confirmClosure: (input: { confirmToken: string; choice: ClosureChoice; confirmText?: string }) =>
    adminCall<{
      ok: true;
      blackoutId: string;
      state: 'pending' | 'done';
      finalizeAt: string | null;
      alreadyConfirmed?: boolean;
      result?: ClosureResult;
    }>('adminConfirmClosure', input),
  undoClosure: (blackoutId: string) =>
    adminCall<{
      ok: true;
      /** Waiting on a new date from an earlier closing of the same trips, and back on them now. Not emailed. */
      restored?: RestoredBookingRow[];
      /** The crew had been told those trips were off: whether the "back on" message reached them all. */
      crewTold?: boolean;
    }>('adminUndoClosure', { blackoutId }),
  sendClosureNow: (blackoutId: string) =>
    adminCall<{ ok: true; result: ClosureResult; retrying: boolean }>('adminSendClosureNow', { blackoutId }),
  deleteBlackout: (blackoutId: string) =>
    adminCall<{
      ok: true;
      undone?: boolean;
      /** Offered a new date, hadn't chosen, and back on their trip now. Not emailed. */
      restored?: RestoredBookingRow[];
      /** The crew had been told those trips were off (or closed, on a day left booked): whether the "back on" message reached them all. */
      crewTold?: boolean;
    }>('adminDeleteBlackout', { blackoutId }),

  // Tours
  updateTour: (
    slug: string,
    patch: Partial<{
      name: string;
      description: string;
      pricePerPerson: number | null;
      flatPrice: number | null;
      active: boolean;
      included: string[];
    }>,
  ) => adminCall<{ ok: true }>('adminUpdateTour', { slug, ...patch }),

  // Seasonal / holiday rates (cents keyed by tour slug)
  upsertRateSeason: (input: {
    id?: string;
    name: string;
    startDate: string;
    endDate: string;
    prices: Record<string, number>;
  }) => adminCall<{ ok: true; id: string }>('adminUpsertRateSeason', input),
  deleteRateSeason: (id: string) =>
    adminCall<{ ok: true }>('adminDeleteRateSeason', { id }),

  // Settings
  updateSettings: (
    patch: Partial<{
      cancellationPolicyText: string;
      contactEmail: string;
      closureUndoMinutes: number;
      googleReviewUrl: string;
      wetsuitSizes: { adult: string[]; kids: string[] };
    }>,
  ) => adminCall<{ ok: true }>('adminUpdateSettings', patch),

  // Site images (metadata only — actual upload happens via Storage SDK)
  updateSiteImage: (input: {
    slot: string;
    storagePath: string;
    downloadUrl: string;
    alt: string;
    width: number | null;
    height: number | null;
  }) => adminCall<{ ok: true }>('adminUpdateSiteImage', input),

  deleteSiteImage: (slot: string) =>
    adminCall<{ ok: true }>('adminDeleteSiteImage', { slot }),

  // Testimonials
  upsertTestimonial: (input: {
    id?: string;
    quote: string;
    author: string;
    location?: string;
    rating?: number;
    source?:
      | 'google'
      | 'tripadvisor'
      | 'facebook'
      | 'instagram'
      | 'direct'
      | 'other';
    sourceUrl?: string;
    reviewedAt?: string;
    featured?: boolean;
    published?: boolean;
    order?: number;
  }) =>
    adminCall<{ ok: true; id: string }>('adminUpsertTestimonial', input),
  deleteTestimonial: (id: string) =>
    adminCall<{ ok: true }>('adminDeleteTestimonial', { id }),

  // Inbox status updates
  updateContactMessage: (id: string, status: 'new' | 'replied' | 'archived') =>
    adminCall<{ ok: true }>('adminUpdateContactMessage', { id, status }),
  updateRescheduleRequest: (
    id: string,
    status: 'open' | 'accepted' | 'declined' | 'resolved',
    notes?: string,
  ) =>
    adminCall<{ ok: true }>('adminUpdateRescheduleRequest', { id, status, notes }),

  // Trip photos
  tripUploadLink: (date: string, timeSlot: string) =>
    adminCall<{ ok: true; tripId: string; uploadUrl: string }>('adminTripUploadLink', { date, timeSlot }),
  deleteTripPhoto: (tripId: string, fileId: string) =>
    adminCall<{ ok: true; driveDeleted: boolean }>('adminDeleteTripPhoto', { tripId, fileId }),

  // Crew (Travis, swim guides and mates: crew emails, and the /crew app)
  addCrewMember: (input: {
    name: string;
    role: 'captain' | 'mate';
    email: string | null;
    phone: string | null;
    alertsOn: boolean;
    password?: string;
  }) => adminCall<{ ok: true; id: string }>('adminAddCrewMember', input),
  updateCrewMember: (
    crewId: string,
    patch: Partial<{
      name: string;
      role: 'captain' | 'mate';
      email: string | null;
      phone: string | null;
      alertsOn: boolean;
    }>,
  ) =>
    adminCall<{ ok: true; signedOutDevices?: number; unchanged?: boolean }>(
      'adminUpdateCrewMember',
      { crewId, ...patch },
    ),
  seedCrew: () => adminCall<{ ok: true; added: number }>('adminSeedCrew', {}),
  setCrewPassword: (crewId: string, password: string) =>
    adminCall<{ ok: true; signedOutDevices: number; calendarLinkStopped?: boolean }>('adminSetCrewPassword', {
      crewId,
      password,
    }),
  removeCrewMember: (crewId: string) =>
    adminCall<{ ok: true }>('adminRemoveCrewMember', { crewId }),
  /**
   * `crewNeeded: false` takes the crew off one trip so Travis runs it alone;
   * `true` puts them back on. The crew get a notification either way.
   */
  setTripCrew: (date: string, timeSlot: string, crewNeeded: boolean) =>
    adminCall<{ ok: true; crewNeeded: boolean; changed: boolean }>('adminSetTripCrew', {
      date,
      timeSlot,
      crewNeeded,
    }),
  /** Emails them a new calendar link; their old one stops working. */
  sendCrewCalendarLink: (crewId: string) =>
    adminCall<{ ok: true; email: string; replacedLinks: number }>('adminSendCrewCalendarLink', { crewId }),
};

'use client';

import { FunctionError } from './functions-client';
import { getAdminIdToken } from './firebase/auth-client';
import type { TourTimeSlot } from './firebase/types';

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
  partialRefund: (bookingId: string, amountCents: number, reason?: string) =>
    adminCall<{ ok: true; stripeRefundId: string; refundCents: number }>(
      'adminPartialRefund',
      { bookingId, amountCents, reason },
    ),
  editBooking: (
    bookingId: string,
    patch: Partial<{
      guestCount: number;
      guests: { name: string; age: number | null }[];
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
    adminCall<{ ok: true }>('adminRescheduleBooking', {
      bookingId,
      newDate,
      newTourSlug,
      notifyCustomer,
    }),
  markBooking: (bookingId: string, status: 'completed' | 'no-show') =>
    adminCall<{ ok: true }>('adminMarkBooking', { bookingId, status }),
  addNote: (bookingId: string, note: string) =>
    adminCall<{ ok: true }>('adminAddNote', { bookingId, note }),
  resendConfirmation: (bookingId: string) =>
    adminCall<{ ok: true }>('adminResendConfirmation', { bookingId }),
  sendPostTourFollowup: (bookingId: string, force = false) =>
    adminCall<{
      sent: boolean;
      skipped?: 'already-sent' | 'not-confirmed' | 'not-found' | 'not-yet' | 'too-old';
    }>('adminSendPostTourFollowup', { bookingId, force }),

  // Blackouts
  createBlackout: (input: {
    date: string;
    affectedSlots: (TourTimeSlot | 'all')[];
    reason?: 'weather' | 'maintenance' | 'personal' | 'other';
    notes?: string;
    cancelAffected?: boolean;
  }) =>
    adminCall<{
      ok: true;
      blackoutId: string;
      cancelledBookingIds: string[];
      cancelled?: Array<{ id: string; customerName: string; refundCents: number; manualRefundCents: number; emailed: boolean }>;
      failed?: Array<{ id: string; customerName: string; error: string }>;
    }>('adminCreateBlackout', input),
  deleteBlackout: (blackoutId: string) =>
    adminCall<{ ok: true }>('adminDeleteBlackout', { blackoutId }),

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

  // Settings
  updateSettings: (
    patch: Partial<{
      cancellationPolicyText: string;
      contactEmail: string;
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
    adminCall<{ ok: true; signedOutDevices: number }>('adminSetCrewPassword', {
      crewId,
      password,
    }),
  removeCrewMember: (crewId: string) =>
    adminCall<{ ok: true }>('adminRemoveCrewMember', { crewId }),
};

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
  cancelBooking: (bookingId: string, reason?: string) =>
    adminCall<{ ok: true; refundCents: number; stripeRefundId: string | null }>(
      'adminCancelBooking',
      { bookingId, reason },
    ),
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

  // Blackouts
  createBlackout: (input: {
    date: string;
    affectedSlots: (TourTimeSlot | 'all')[];
    reason?: 'weather' | 'maintenance' | 'personal' | 'other';
    notes?: string;
    cancelAffected?: boolean;
  }) =>
    adminCall<{ ok: true; blackoutId: string; cancelledBookingIds: string[] }>(
      'adminCreateBlackout',
      input,
    ),
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
};

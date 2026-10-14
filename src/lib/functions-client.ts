/**
 * Client-side fetcher for Cloud Functions calls.
 *
 * Reads `NEXT_PUBLIC_FUNCTIONS_BASE_URL` so the deployed app and the local
 * emulator share a code path. Throws descriptive errors when not configured.
 */

import type { TourTimeSlot } from './firebase/types';

function baseUrl(): string {
  const url = process.env.NEXT_PUBLIC_FUNCTIONS_BASE_URL;
  if (!url) {
    throw new Error(
      'NEXT_PUBLIC_FUNCTIONS_BASE_URL is not set. ' +
        "Add it to .env.local (e.g. http://127.0.0.1:5001/<project>/us-central1 for the emulator).",
    );
  }
  return url.replace(/\/$/, '');
}

interface RequestOpts {
  signal?: AbortSignal;
}

async function call<T>(
  name: string,
  init: RequestInit,
  opts?: RequestOpts,
): Promise<T> {
  const res = await fetch(`${baseUrl()}/${name}`, {
    ...init,
    signal: opts?.signal,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const message =
      (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
        ? body.error
        : null) || res.statusText || `Request to ${name} failed`;
    const err = new FunctionError(message, res.status, body);
    throw err;
  }
  return body as T;
}

/**
 * What to tell a customer when their booking can't be loaded. The raw
 * server message ("Missing bookingId or accessToken", "Failed to fetch")
 * is for logs, not people.
 */
export function bookingLoadMessage(err: unknown): string {
  if (err instanceof FunctionError && err.status >= 400 && err.status < 500) {
    return 'We couldn’t open a booking with this link. Use the link in your confirmation email.';
  }
  if (err instanceof FunctionError) {
    return 'The booking system had a problem loading this. Please try again in a minute.';
  }
  return 'We couldn’t reach the booking system. Check your connection and refresh the page.';
}

export class FunctionError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(message);
    this.name = 'FunctionError';
  }

  /** Convenience accessor for the `reason` field used by availability errors. */
  get reason(): string | undefined {
    if (this.body && typeof this.body === 'object' && 'reason' in this.body) {
      return String((this.body as { reason: unknown }).reason);
    }
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Typed call helpers
// ---------------------------------------------------------------------------

export interface SlotAvailability {
  timeSlot: TourTimeSlot;
  sharedRemaining: number;
  privateAvailable: boolean;
  blackedOut: boolean;
  wholeDayBooked: boolean;
}

export function getDayAvailability(
  date: string,
  opts?: RequestOpts,
): Promise<{ slots: SlotAvailability[] }> {
  return call(`getAvailability?date=${encodeURIComponent(date)}`, { method: 'GET' }, opts);
}

export function getMonthBlackouts(
  year: number,
  month: number,
  opts?: RequestOpts,
): Promise<{ blackouts: string[] }> {
  return call(
    `getAvailability?year=${year}&month=${month}`,
    { method: 'GET' },
    opts,
  );
}

export interface CreateCheckoutInput {
  tourSlug: string;
  date: string;
  guestCount: number;
  customer: { name: string; email: string; phone: string };
  emergencyContact: { name: string; phone: string };
  guests: { name: string; age: number | null }[];
  acknowledgements: {
    manateeManners: true;
    liabilityWaiver: true;
    termsOfService: true;
  };
  /** The Terms of Service date the guest agreed to (`TERMS_VERSION`). */
  termsVersion: string;
  /** An unpaid checkout this one replaces. The server frees its seats first. */
  previousBooking?: CheckoutHold;
}

/** Identifies an unpaid checkout: what createCheckoutSession returned. */
export interface CheckoutHold {
  bookingId: string;
  accessToken: string;
}

export interface CreateCheckoutResponse {
  bookingId: string;
  accessToken: string;
  checkoutUrl: string;
}

export function createCheckoutSession(
  input: CreateCheckoutInput,
): Promise<CreateCheckoutResponse> {
  return call('createCheckoutSession', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export interface ReleaseCheckoutHoldResponse {
  outcome: 'released' | 'not-held' | 'checkout-complete' | 'no-session';
}

/**
 * Free the seats held by a checkout the customer walked away from. Safe to
 * call on a checkout that was paid: the server leaves those alone.
 */
export function releaseCheckoutHold(
  hold: CheckoutHold,
): Promise<ReleaseCheckoutHoldResponse> {
  return call('releaseCheckoutHold', {
    method: 'POST',
    body: JSON.stringify(hold),
  });
}

export interface FetchedBooking {
  id: string;
  tourId: string;
  tourName: string;
  date: string;
  timeSlot: TourTimeSlot;
  type: 'shared' | 'private';
  guestCount: number;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  guests: { name: string; age: number | null }[];
  status:
    | 'pending-payment'
    | 'confirmed'
    | 'cancelled'
    | 'completed'
    | 'no-show';
  paymentStatus: 'pending' | 'paid' | 'refunded' | 'partial-refund' | 'failed';
  amountPaidCents: number;
  amountRefundedCents: number;
  accessToken: string;
  createdAt: string | null;
  updatedAt: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
}

export function fetchBooking(
  bookingId: string,
  accessToken: string,
): Promise<{ booking: FetchedBooking }> {
  return call('fetchBooking', {
    method: 'POST',
    body: JSON.stringify({ bookingId, accessToken }),
  });
}

export interface CancelBookingResponse {
  ok?: boolean;
  alreadyCancelled?: boolean;
  refundCents?: number;
  refundPercent?: number;
  policyTier?: 'full' | 'half' | 'none';
  stripeRefundId?: string | null;
  booking?: {
    id: string;
    status: string;
    amountRefundedCents: number;
  };
}

export function cancelBooking(input: {
  bookingId: string;
  accessToken: string;
  reason?: string;
}): Promise<CancelBookingResponse> {
  return call('cancelBooking', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export interface RescheduleResponse {
  ok: boolean;
  requestId: string;
}

export function requestReschedule(input: {
  bookingId: string;
  accessToken: string;
  requestedDate: string;
  requestedSlot?: TourTimeSlot;
  notes?: string;
}): Promise<RescheduleResponse> {
  return call('requestReschedule', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

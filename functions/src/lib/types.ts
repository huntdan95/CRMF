/**
 * MUST stay in sync with `src/lib/firebase/types.ts` in the parent Next.js app.
 * Duplicated here because `functions/` is a separate workspace with its own
 * tsconfig (rootDir = `src/`), so imports from the parent project are not
 * permitted by the build.
 *
 * If you add a field to one, add it to the other.
 */

import type { Timestamp } from 'firebase-admin/firestore';

export type TourTimeSlot =
  | 'morning'
  | 'mid-morning'
  | 'early-afternoon'
  | 'late-afternoon'
  | 'whole-day';

export type TourType = 'shared' | 'private';

export interface Tour {
  id: string;
  slug: string;
  name: string;
  timeSlot: TourTimeSlot;
  startTime: string;
  durationHours: number;
  type: TourType;
  pricePerPerson: number | null;
  flatPrice: number | null;
  maxGuests: number;
  description: string;
  included: string[];
  active: boolean;
}

export type BookingStatus =
  | 'pending-payment'
  | 'confirmed'
  | 'cancelled'
  | 'completed'
  | 'no-show';

export type PaymentStatus =
  | 'pending'
  | 'paid'
  | 'refunded'
  | 'partial-refund'
  | 'failed';

export interface BookingGuest {
  name: string;
  age: number | null;
}

export interface Booking {
  id: string;
  tourId: string;
  tourName: string;
  date: string;
  timeSlot: TourTimeSlot;
  type: TourType;
  guestCount: number;

  customerName: string;
  customerEmail: string;
  customerPhone: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  guests: BookingGuest[];

  status: BookingStatus;

  stripeCheckoutSessionId?: string;
  stripePaymentIntentId?: string;
  amountPaidCents: number;
  amountRefundedCents: number;
  paymentStatus: PaymentStatus;

  manateeMannersAcknowledged: boolean;
  manateeMannersAcknowledgedAt: Timestamp;
  liabilityWaiverSigned: boolean;
  liabilityWaiverSignedAt: Timestamp;

  adminNotes?: string;
  cancellationReason?: string;
  cancelledAt?: Timestamp;
  cancelledBy?: 'customer' | 'admin';

  accessToken: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export type BlackoutReason = 'weather' | 'maintenance' | 'personal' | 'other';
export type BlackoutSlot = TourTimeSlot | 'all';

export interface Blackout {
  id: string;
  date: string;
  affectedSlots: BlackoutSlot[];
  reason?: BlackoutReason;
  notes?: string;
  createdAt: Timestamp;
}

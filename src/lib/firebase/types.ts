/**
 * Canonical Firestore document types.
 *
 * Server-side (Cloud Functions, server actions, scripts) use these directly,
 * including the `Timestamp` fields. For client transport, use the `Serialize<T>`
 * helper — Timestamps become ISO-8601 strings.
 *
 * Mirrors the spec in the rebuild-plan-v2 doc verbatim. If a field needs to be
 * added, update both the spec and this file.
 */

import type { Timestamp } from 'firebase-admin/firestore';

/* -------------------------------------------------------------------------- */
/* Tour                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Tour time slots. Schedule (America/New_York, confirmed 2026-05-20):
 *  - morning         08:00 - 10:00
 *  - mid-morning     10:30 - 12:30
 *  - early-afternoon 13:00 - 15:00
 *  - late-afternoon  15:30 - 17:30
 *  - whole-day       07:00 - ~15:00 (private only)
 */
export type TourTimeSlot =
  | 'morning'
  | 'mid-morning'
  | 'early-afternoon'
  | 'late-afternoon'
  | 'whole-day';

export type TourType = 'shared' | 'private';

export interface Tour {
  /** Firestore document id; identical to {@link Tour.slug}. */
  id: string;
  /** URL-safe identifier, e.g. `early-shared`. */
  slug: string;
  name: string;
  timeSlot: TourTimeSlot;
  /** 24-hour local (America/New_York) start time, e.g. `08:00`. */
  startTime: string;
  durationHours: number;
  type: TourType;
  /** Cents per guest for shared tours; `null` for private. */
  pricePerPerson: number | null;
  /** Cents flat for the whole boat; `null` for shared tours. */
  flatPrice: number | null;
  maxGuests: number;
  description: string;
  included: string[];
  active: boolean;
}

/* -------------------------------------------------------------------------- */
/* Booking                                                                    */
/* -------------------------------------------------------------------------- */

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
  /** `null` when the guest didn't supply an age (some kids opt out of asking). */
  age: number | null;
}

export interface Booking {
  id: string;
  /** {@link Tour.id} of the booked tour. */
  tourId: string;
  /** Denormalized {@link Tour.name} so booking listings don't need a join. */
  tourName: string;
  /** Booking date in `YYYY-MM-DD` in America/New_York. */
  date: string;
  timeSlot: TourTimeSlot;
  type: TourType;
  guestCount: number;

  // ---- Customer ----------------------------------------------------------
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  guests: BookingGuest[];

  // ---- Lifecycle ---------------------------------------------------------
  status: BookingStatus;

  // ---- Payment (Stripe) --------------------------------------------------
  stripeCheckoutSessionId?: string;
  stripePaymentIntentId?: string;
  amountPaidCents: number;
  amountRefundedCents: number;
  paymentStatus: PaymentStatus;

  // ---- Acknowledgements (USFWS / liability) ------------------------------
  manateeMannersAcknowledged: boolean;
  manateeMannersAcknowledgedAt: Timestamp;
  liabilityWaiverSigned: boolean;
  liabilityWaiverSignedAt: Timestamp;

  // ---- Admin -------------------------------------------------------------
  adminNotes?: string;
  cancellationReason?: string;
  cancelledAt?: Timestamp;
  cancelledBy?: 'customer' | 'admin';

  // ---- Customer self-service (token-authenticated, no login) ------------
  /** Random UUIDv4; gates `/my-booking/[id]?t=[token]`. */
  accessToken: string;

  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/* -------------------------------------------------------------------------- */
/* Blackout                                                                   */
/* -------------------------------------------------------------------------- */

export type BlackoutReason = 'weather' | 'maintenance' | 'personal' | 'other';

/** `'all'` is a valid entry in `affectedSlots` meaning the whole day is closed. */
export type BlackoutSlot = TourTimeSlot | 'all';

export interface Blackout {
  id: string;
  /** `YYYY-MM-DD` in America/New_York. */
  date: string;
  affectedSlots: BlackoutSlot[];
  reason?: BlackoutReason;
  notes?: string;
  createdAt: Timestamp;
}

/* -------------------------------------------------------------------------- */
/* Contact form                                                                */
/* -------------------------------------------------------------------------- */

export type ContactStatus = 'new' | 'replied' | 'archived';

export interface ContactMessage {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  subject: string | null;
  message: string;
  status: ContactStatus;
  createdAt: Timestamp;
}

/* -------------------------------------------------------------------------- */
/* Reschedule request                                                          */
/* -------------------------------------------------------------------------- */

export type RescheduleStatus = 'open' | 'accepted' | 'declined' | 'resolved';

export interface RescheduleRequest {
  id: string;
  bookingId: string;
  bookingCustomerEmail: string;
  bookingDate: string;
  bookingTimeSlot: TourTimeSlot;
  requestedDate: string;
  requestedSlot: TourTimeSlot | null;
  notes: string | null;
  status: RescheduleStatus;
  createdAt: Timestamp;
}

/* -------------------------------------------------------------------------- */
/* Site images (admin-uploaded photos used across marketing pages)            */
/* -------------------------------------------------------------------------- */

/**
 * Stable slot identifiers — components reference these by name. Each maps
 * to at most one image at a time. Update the `SITE_IMAGE_SLOTS` constant in
 * `src/lib/site-images.ts` when adding new ones.
 *
 * Two groups:
 *  - Site sections (hero, about-*, manners-callout) — used by the
 *    marketing layout components.
 *  - Per-tour cards (tour-{slug}) — one per active tour so each card on
 *    /tours and the home featured grid shows its own dedicated photo.
 *
 * The legacy names (pair, greeting, dappled, group) are kept as fallback
 * targets so existing uploads from before this refactor still display
 * until the owner uploads new tour-specific or section-specific photos.
 */
export type SiteImageSlot =
  // Site sections
  | 'hero'
  | 'manners-callout'
  | 'about-captain'
  | 'about-area'
  // Per-tour cards
  | 'tour-morning-shared'
  | 'tour-morning-private'
  | 'tour-mid-morning-shared'
  | 'tour-mid-morning-private'
  | 'tour-early-afternoon-shared'
  | 'tour-early-afternoon-private'
  | 'tour-late-afternoon-shared'
  | 'tour-late-afternoon-private'
  | 'tour-whole-day-private'
  // Legacy slots — kept so older uploads still display via fallback
  | 'pair'
  | 'greeting'
  | 'dappled'
  | 'group';

export interface SiteImage {
  slot: SiteImageSlot;
  storagePath: string;
  downloadUrl: string;
  alt: string;
  width: number | null;
  height: number | null;
  updatedAt: Timestamp;
  updatedBy: string;
}

/* -------------------------------------------------------------------------- */
/* Audit log (admin-mutating actions write here from Cloud Functions)         */
/* -------------------------------------------------------------------------- */

export type AuditAction =
  | 'booking.create'
  | 'booking.update'
  | 'booking.cancel'
  | 'booking.refund'
  | 'booking.reschedule'
  | 'booking.no-show'
  | 'booking.complete'
  | 'blackout.create'
  | 'blackout.delete'
  | 'tour.update';

export interface AuditEntry {
  id: string;
  action: AuditAction;
  actorEmail: string;
  /** Doc id of the affected booking / blackout / tour. */
  targetId: string;
  /** Free-form JSON payload (before/after snapshot, etc.). */
  payload: Record<string, unknown>;
  createdAt: Timestamp;
}

/* -------------------------------------------------------------------------- */
/* Client-side serialization helper                                            */
/* -------------------------------------------------------------------------- */

/**
 * Maps a server type with Firestore `Timestamp` fields onto a client-safe
 * variant whose Timestamps are ISO-8601 strings. Use whenever returning
 * documents to the browser (Cloud Functions, server actions returning JSON).
 */
export type Serialize<T> = {
  [K in keyof T]: T[K] extends Timestamp
    ? string
    : T[K] extends Timestamp | undefined
      ? string | undefined
      : T[K] extends Timestamp[]
        ? string[]
        : T[K] extends Array<infer U>
          ? Array<Serialize<U>>
          : T[K] extends object
            ? Serialize<T[K]>
            : T[K];
};

export type SerializedBooking = Serialize<Booking>;
export type SerializedBlackout = Serialize<Blackout>;
export type SerializedContactMessage = Serialize<ContactMessage>;
export type SerializedAuditEntry = Serialize<AuditEntry>;

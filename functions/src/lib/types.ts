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

/** Date-range prices; see `src/lib/firebase/types.ts`. */
export interface RateSeason {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  prices: Record<string, number>;
  createdAt: Timestamp;
  updatedAt: Timestamp;
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
  /**
   * Partial refunds Travis gave from the booking page, by the request id the
   * refund window sent, so a retried request isn't refunded twice
   * (lib/admin-refund.ts).
   */
  refundRequests?: Record<string, { refundCents: number; stripeRefundId: string }>;

  manateeMannersAcknowledged: boolean;
  manateeMannersAcknowledgedAt: Timestamp;
  liabilityWaiverSigned: boolean;
  liabilityWaiverSignedAt: Timestamp;
  /**
   * The Terms of Service the customer agreed to at checkout: the "Last
   * updated" date the terms page showed. Absent on bookings made before
   * checkout asked.
   */
  termsVersion?: string;
  termsAcceptedAt?: Timestamp;

  adminNotes?: string;
  cancellationReason?: string;
  cancelledAt?: Timestamp;
  cancelledBy?: 'customer' | 'admin';

  accessToken: string;
  /** Set on bookings imported from the old WordPress site (scripts/import-legacy-bookings.ts). */
  legacy?: { bookingId: number; [key: string]: unknown };
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

export type TestimonialSource =
  | 'google'
  | 'tripadvisor'
  | 'facebook'
  | 'instagram'
  | 'direct'
  | 'other';

export interface Testimonial {
  id: string;
  quote: string;
  author: string;
  location: string | null;
  rating: number | null;
  source: TestimonialSource;
  sourceUrl: string | null;
  reviewedAt: string | null;
  featured: boolean;
  published: boolean;
  order: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export type SiteImageSlot =
  | 'hero'
  | 'manners-callout'
  | 'about-captain'
  | 'about-area'
  | 'tour-morning-shared'
  | 'tour-morning-private'
  | 'tour-mid-morning-shared'
  | 'tour-mid-morning-private'
  | 'tour-early-afternoon-shared'
  | 'tour-early-afternoon-private'
  | 'tour-late-afternoon-shared'
  | 'tour-late-afternoon-private'
  | 'tour-whole-day-private'
  // Legacy slots — fallback for pre-refactor uploads
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

export type AuditAction =
  | 'booking.create'
  | 'booking.update'
  | 'booking.cancel'
  | 'booking.refund'
  | 'booking.reschedule'
  | 'booking.no-show'
  | 'booking.complete'
  | 'booking.note'
  | 'blackout.create'
  | 'blackout.delete'
  | 'tour.update'
  | 'rateSeason.upsert'
  | 'rateSeason.delete'
  | 'siteImage.update'
  | 'siteImage.delete'
  | 'testimonial.upsert'
  | 'testimonial.delete'
  | 'settings.update'
  | 'message.update'
  | 'reschedule.update'
  | 'crew.add'
  | 'crew.password'
  | 'crew.remove';

export interface AuditEntry {
  id: string;
  action: AuditAction;
  actorEmail: string;
  /** `'mcp'` when the change came through the site's MCP endpoint. */
  via?: 'mcp';
  targetId: string;
  payload: Record<string, unknown>;
  createdAt: Timestamp;
}

/**
 * Imported from the old site: paid there, so there's no Stripe payment here
 * to refund against, and the customer self-service page can't handle money.
 */
export function isLegacyBooking(b: Pick<Booking, 'id' | 'legacy'>): boolean {
  return !!b.legacy || b.id.startsWith('legacy-');
}

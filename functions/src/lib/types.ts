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
  | 'whole-day'
  /** Private cruise, April 1 – November 14, leaving 90 min before sunset. */
  | 'sunset';

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
  /**
   * Travis closed this departure and offered the customer another date or a
   * full refund instead of cancelling it (adminBlackouts.ts). Cleared once
   * they move (moveClosedBooking.ts). Still unanswered after `decideBy`, it's
   * cancelled and refunded in full (settleClosedBookings).
   */
  closure?: BookingClosure;
  /**
   * `date/timeSlot` the day-before reminder went out for (tourReminders.ts),
   * so a booking moved to another day gets one for that day too.
   */
  reminderSentFor?: string;

  /**
   * Emails to the customer that bounced, by kind (`confirmation`,
   * `reminder`…), from the Resend webhook (resendWebhook.ts). Admin shows
   * them as "Email bounced"; fixing the address clears them.
   */
  emailBounces?: Record<string, EmailBounce>;
  /** When Travis was emailed about a bounce or delay of each kind: one alert per kind. */
  bounceAlertSentAt?: Record<string, Timestamp>;
  /** An alert of that kind being sent right now (ms since epoch), so two webhook calls can't both send it. */
  bounceAlertClaims?: Record<string, number>;
  /** The customer marked one of our emails as spam: nothing promotional goes to them. */
  marketingSuppressed?: boolean;

  accessToken: string;
  /** Set on bookings imported from the old WordPress site (scripts/import-legacy-bookings.ts). */
  legacy?: { bookingId: number; [key: string]: unknown };
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** One bounced email to the customer; see {@link Booking.emailBounces}. */
export interface EmailBounce {
  /** Resend's email id, the emailLog document. */
  emailId: string;
  /** The address it bounced from. */
  to: string;
  subject: string;
  /** Resend's `bounce.type`: Permanent, Transient or Undetermined. */
  bounceType: string | null;
  bounceMessage: string | null;
  at: Timestamp;
}

export interface BookingClosure {
  blackoutId: string;
  /** What the customer was told, e.g. "Closed for weather". */
  reason: string;
  /** Last day to pick a new date (YYYY-MM-DD, marina time); after it, a full refund. */
  decideBy: string;
  offeredAt: Timestamp;
  /** When the pick-a-new-date email went out (lib/close-day.ts). */
  offerEmailedAt?: Timestamp;
  /** The one reminder the day before the deadline (closureReminders.ts). */
  reminderSentAt?: Timestamp;
}

/**
 * What Travis chose for the people booked on departures he closed:
 * `offer` emails them to pick a new date or take a full refund, `cancel`
 * cancels and refunds them, `keep` leaves them booked for him to call.
 */
export type ClosureChoice = 'offer' | 'cancel' | 'keep';

/** What closing a day did to each booking (lib/close-day.ts). */
export interface ClosureResult {
  cancelled: Array<{
    id: string;
    customerName: string;
    timeSlot: TourTimeSlot;
    guests: number;
    refundCents: number;
    manualRefundCents: number;
    emailed: boolean;
    /** A checkout that was still being paid for. */
    unpaidCheckout?: boolean;
    /**
     * Found cancelled after a finalize that crashed partway: the refund went
     * through, but whether the customer was emailed isn't known.
     */
    recovered?: boolean;
  }>;
  offered: Array<{ id: string; customerName: string; timeSlot: TourTimeSlot; guests: number; decideBy: string; emailed: boolean }>;
  /** Left booked for Travis to contact (`keep`). */
  kept?: Array<{ id: string; customerName: string; timeSlot: TourTimeSlot; guests: number }>;
  /** `retryable`: paid while we tried to cancel; tried again shortly. */
  failed: Array<{ id: string; customerName: string; error: string; retryable?: boolean }>;
}

/** One booking's outcome in a closure, as saved on `closureActions/{id}.progress`. */
export type ClosureProgressEntry =
  | { bucket: 'cancelled'; entry: ClosureResult['cancelled'][number] }
  | { bucket: 'offered'; entry: ClosureResult['offered'][number] }
  | { bucket: 'failed'; entry: ClosureResult['failed'][number] };

/**
 * `closureActions/{blackoutId}`, server-only. A day Travis confirmed
 * closing: the blackout is up at once, and what happens to the bookings
 * waits until `finalizeAt` so a wrong tap can be undone with nothing sent.
 */
export interface ClosureAction {
  id: string;
  blackoutId: string;
  date: string;
  affectedSlots: BlackoutSlot[];
  reason: BlackoutReason | null;
  notes: string | null;
  choice: ClosureChoice;
  /**
   * `pending`: in the undo window. `finalizing`: claimed by Send now or the
   * scheduler. `done`: finished. `undone`: taken back, nothing was sent.
   */
  state: 'pending' | 'finalizing' | 'done' | 'undone';
  createdBy: string;
  createdByUid: string;
  createdAt: Timestamp;
  undoMinutes: number;
  finalizeAt: Timestamp;
  previewBookingIds: string[];
  previewFingerprint: string;
  /** Last day for customers to choose (`offer`), fixed when Travis confirmed so the emails match the preview. */
  decideBy: string;
  /** For the countdown banner: what's being called off, as previewed. */
  summary: { bookings: number; guests: number; departs: string[] };
  claimedAt?: Timestamp;
  claimedBy?: 'scheduler' | 'send-now' | 'immediate';
  claims?: number;
  /** A booking was paid as we tried to cancel it: run again at this time. */
  retryAt?: Timestamp;
  retries?: number;
  finalizedAt?: Timestamp;
  finalizedBy?: 'scheduler' | 'send-now' | 'immediate';
  result?: ClosureResult;
  /**
   * The bookings the closure hit, fixed the first time it's claimed, so a
   * finalize that dies partway can be picked up without losing anyone.
   */
  targetIds?: string[];
  /**
   * Each booking's outcome, saved as it happens: `progress.<bookingId>`.
   * A rerun after a crash starts from these.
   */
  progress?: Record<string, ClosureProgressEntry>;
  /** The "here's what's left for you to do" email to whoever closed the day. */
  adminSummary?: { claimedAt: Timestamp; sentAt?: Timestamp; to?: string; failed?: boolean };
  undoneAt?: Timestamp;
  undoneBy?: string;
  crewAlert?: {
    claimedAt: Timestamp;
    sentAt?: Timestamp;
    subject?: string;
    pushed?: boolean;
    emailedCrewIds?: string[];
    failedCrewIds?: string[];
  };
}

/**
 * A trip that's going ahead: confirmed, or reserved on the old site with a
 * deposit and the balance due on the day (the importer files those as
 * pending-payment). A new-site pending-payment is a checkout in progress.
 */
export function isGoingAhead(b: Pick<Booking, 'id' | 'legacy' | 'status'>): boolean {
  if (b.status === 'confirmed') return true;
  return b.status === 'pending-payment' && isLegacyBooking(b) && b.legacy?.oldStatus === 'reserved';
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
  | 'closure.preview'
  | 'closure.confirm'
  | 'closure.undo'
  | 'closure.send-now'
  | 'closure.finalize'
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
  | 'crew.remove'
  | 'crew.trip'
  /** A new calendar link for a crew member (the old one stops working). */
  | 'crew.calendar';

export interface AuditEntry {
  id: string;
  action: AuditAction;
  actorEmail: string;
  /**
   * `'mcp'` when the change came through the site's MCP endpoint;
   * `'scheduler'` when a scheduled job finished something an admin started.
   */
  via?: 'mcp' | 'scheduler';
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

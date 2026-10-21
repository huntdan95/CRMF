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
  /**
   * Picked at booking from settings.wetsuitSizes: an adult size ("XL") or
   * "Kids <size>" ("Kids 8"). Missing on bookings made before sizes were
   * asked for.
   */
  wetsuitSize?: string | null;
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
  /**
   * Paid on the old website and owed back when the booking was cancelled
   * (lib/admin-cancel.ts). Travis refunds it by hand in Stripe, so it's
   * never in `amountRefundedCents`; Reports and the dashboard count it as
   * given back, not kept.
   */
  manualRefundCents?: number;
  /**
   * When Travis recorded that he'd refunded `manualRefundCents` by hand
   * (admin's "Refunded by hand", lib/admin-manual-refund.ts). The amount
   * stays in `manualRefundCents`.
   */
  manualRefundedAt?: Timestamp;
  /** Tour price before tax, and the Florida sales tax on it (both in amountPaidCents). Unset on bookings made before tax was added. */
  subtotalCents?: number;
  salesTaxCents?: number;
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
  /**
   * The reason is Travis's own note: he cancelled without emailing the
   * customer, where the admin page says only he sees it. fetchBooking
   * leaves it off the customer's booking page.
   */
  cancellationReasonPrivate?: boolean;
  cancelledAt?: Timestamp;
  /**
   * `system`: an unpaid checkout the site let go of by itself (Stripe
   * expired it, or the bank payment failed). Older ones say `admin`.
   */
  cancelledBy?: 'customer' | 'admin' | 'system';
  /**
   * What the customer's own cancel refunded (cancelBooking.ts), not counting
   * refunds Travis gave before it: the figure the crew alert and Travis's
   * push give.
   */
  cancelRefundCents?: number;
  /**
   * Travis closed this departure and offered the customer another date or a
   * full refund instead of cancelling it (adminBlackouts.ts). Cleared once
   * they move (moveClosedBooking.ts), or when Travis reopens the day before
   * the trip leaves. Still unanswered after `decideBy`, it's cancelled and
   * refunded in full (settleClosedBookings).
   */
  closure?: BookingClosure;
  /**
   * Travis reopened the day after offering this booking a new date or a full
   * refund, and put it back on its trip (lib/close-day.ts): the offer's
   * `decideBy` (YYYY-MM-DD, marina time). Until the end of that day a
   * customer cancel is refunded in full, not under the 72-hour policy
   * (cancelBooking.ts), since the offer promised it in writing. Cleared when
   * the booking moves: Travis moving it (lib/admin-reschedule.ts), or the
   * customer after another closure (lib/closure.ts).
   */
  refundGraceUntil?: string;
  /** The closure (its blackout id) that cancelled this booking, if one did (lib/close-day.ts). */
  cancelledByClosure?: string;
  /** What that closure's cancel refunded through Stripe, not counting refunds before it. */
  closureRefundCents?: number;
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
  /**
   * Hash of the visitor's IP address when they started the checkout (never
   * the address itself): how createCheckoutSession counts one visitor's
   * unpaid checkouts (lib/checkout-limit.ts). Missing when no address could
   * be told, and taken off once the booking is paid or the checkout is let
   * go: only an unpaid one is counted.
   */
  checkoutIpHash?: string;
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
  /**
   * Stripe turned down the full refund the deadline was due to send (the
   * payment is disputed, say): nothing was cancelled, settleClosedBookings
   * doesn't try it again, and the dashboard lists it as "Refund failed"
   * until Travis sorts it out. `alertedAt`: when he was emailed about it.
   */
  refundRefused?: { at: Timestamp; refundCents: number; stripeMessage: string; alertedAt?: Timestamp };
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
  /**
   * `retryable`: paid while we tried to cancel; tried again shortly.
   * `refundedAnyway`: refunded, but moved or cancelled another way at the
   * same moment, so it mustn't be cancelled again; `error` says what to check.
   */
  failed: Array<{ id: string; customerName: string; error: string; retryable?: boolean; refundedAnyway?: boolean }>;
  /**
   * Whether the crew's "trips are off" push and every crew email went
   * (finalizeClosure). Missing when there was nobody to tell them about.
   */
  crewTold?: boolean;
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
  /**
   * Its cancels stamp each booking with its id (`cancelledByClosure`), as
   * every closure confirmed since that field was added does. One confirmed
   * before, picked up again after a crash, finds the bookings it cancelled
   * the way that version did (recoverCancelled in lib/close-day.ts).
   */
  stampsCancels?: boolean;
  /** Last day for customers to choose (`offer`), fixed when Travis confirmed so the emails match the preview. */
  decideBy: string;
  /**
   * For the countdown banner: what's being called off, as previewed.
   * `unknown`: bookings with no party size on file (old-site), not in
   * `guests`; missing on closures confirmed before it was added.
   */
  summary: { bookings: number; guests: number; unknown?: number; departs: string[] };
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
  /**
   * The "here's what's left for you to do" email to whoever closed the day.
   * `failed`: Resend refused it; finalizeDueClosures tries it again
   * (`tries` so far, the last at `triedAt`).
   */
  adminSummary?: { claimedAt: Timestamp; sentAt?: Timestamp; to?: string; failed?: boolean; tries?: number; triedAt?: Timestamp };
  undoneAt?: Timestamp;
  undoneBy?: string;
  /**
   * Undone while another closed day still covered all or some of its trips
   * (stillClosedBy in lib/close-day.ts): those didn't open for booking again.
   */
  stillClosed?: 'all' | 'some';
  crewAlert?: {
    claimedAt: Timestamp;
    sentAt?: Timestamp;
    subject?: string;
    pushed?: boolean;
    emailedCrewIds?: string[];
    failedCrewIds?: string[];
    /**
     * On a day closed from MCP (the alert is on its blackout), whom it
     * left booked, as `result.kept` on a closure: no names. The crew app
     * lists those trips as called off once Travis has cancelled or moved
     * them all (calledOffDepartures in src/lib/departure-off.ts).
     */
    kept?: Array<{ id: string; timeSlot: TourTimeSlot; guests: number }>;
  };
  /**
   * Bookings a reopen put back on their trips, added as each one goes back,
   * so a reopen retried after failing partway still lists them all.
   */
  restoredBookingIds?: string[];
  /**
   * When Travis reopened the day (restoreOfferedBookings), before the
   * blackout came down. A booking still waiting on this closure after that
   * was left waiting on purpose: its trip had already left. Without it, the
   * day was reopened by the old version of the site, which put nobody back
   * (isStaleClosure in lib/close-day.ts).
   */
  reopenedAt?: Timestamp;
  /** The crew told the trips are back on after a reopen, the same way as `crewAlert`. */
  reopenCrewAlert?: {
    claimedAt: Timestamp;
    sentAt?: Timestamp;
    subject?: string;
    pushed?: boolean;
    emailedCrewIds?: string[];
    failedCrewIds?: string[];
    /** The bookings it said are back on. Missing on one sent before this was recorded. */
    bookingIds?: string[];
  };
  /**
   * The same, for bookings this closure's alert named that went back on
   * when a day closed from MCP (no closure of its own, so nowhere else to
   * record it) came down, by that blackout's id.
   */
  reopenCrewAlertsFor?: Record<string, NonNullable<ClosureAction['reopenCrewAlert']>>;
}

/**
 * A trip that's going ahead: confirmed, or held on the old site with the
 * balance due on the day (the importer files those as pending-payment; an
 * old order with nothing paid comes over cancelled). A new-site
 * pending-payment is a checkout in progress.
 */
export function isGoingAhead(b: Pick<Booking, 'id' | 'legacy' | 'status'>): boolean {
  if (b.status === 'confirmed') return true;
  return b.status === 'pending-payment' && isLegacyBooking(b);
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
  /**
   * A day closed from MCP with people booked on it: the crew's "Closed"
   * alert, as a closure's `crewAlert` (alertCrewClosedFromMcp in
   * lib/close-day.ts). A day closed in admin has it on its closure action.
   */
  crewAlert?: ClosureAction['crewAlert'];
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
  /** "Erase personal details": what was erased, never the details. */
  | 'booking.erase'
  | 'review.send'
  | 'review.hold'
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
  | 'tripPhoto.delete'
  | 'crew.add'
  | 'crew.update'
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

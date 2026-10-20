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
 *  - sunset          90 min before sunset, 2 hours, April 1 - November 14
 *                    (private cruise only; see src/lib/schedule.ts)
 */
export type TourTimeSlot =
  | 'morning'
  | 'mid-morning'
  | 'early-afternoon'
  | 'late-afternoon'
  | 'whole-day'
  | 'sunset';

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

/**
 * A date range with its own prices: a season ("Peak season", Dec 15 –
 * Mar 31) or a single holiday. Prices are cents keyed by tour slug, in the
 * tour's own unit (per person for shared, the whole boat for private). A
 * tour left out keeps its standard price. Where ranges overlap, the
 * shortest one that prices the tour wins, so a holiday week can sit inside
 * a season. Resolution lives in `src/lib/pricing.ts`.
 */
export interface RateSeason {
  id: string;
  name: string;
  /** First day, `YYYY-MM-DD` in America/New_York. */
  startDate: string;
  /** Last day, inclusive. */
  endDate: string;
  prices: Record<string, number>;
  createdAt: Timestamp;
  updatedAt: Timestamp;
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
  /**
   * Picked at booking from settings.wetsuitSizes: an adult size ("XL") or
   * "Kids <size>" ("Kids 8"). Missing on bookings made before sizes were
   * asked for.
   */
  wetsuitSize?: string | null;
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
  /**
   * Paid on the old website and owed back when the booking was cancelled.
   * Travis refunds it by hand, so it's never in `amountRefundedCents`;
   * Reports and the dashboard count it as given back, not kept.
   */
  manualRefundCents?: number;
  /**
   * When Travis recorded that he'd refunded `manualRefundCents` by hand
   * (admin's "Refunded by hand"). The amount stays in `manualRefundCents`.
   */
  manualRefundedAt?: Timestamp;
  /**
   * Tour price before tax, and the Florida sales tax on it (both in
   * `amountPaidCents`). Unset on bookings made before tax was added, and on
   * old-site imports, whose amounts include the old site's 6%.
   */
  subtotalCents?: number;
  salesTaxCents?: number;
  paymentStatus: PaymentStatus;

  // ---- Acknowledgements (USFWS / liability) ------------------------------
  // `liabilityWaiverSigned` records the checkout checkbox ("everyone in my
  // party will sign"), not a signature. Signed waivers are `waivers/{id}`
  // docs (src/lib/waiver/types.ts).
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

  // ---- Admin -------------------------------------------------------------
  adminNotes?: string;
  cancellationReason?: string;
  /** Travis's own reason, given without emailing the customer: kept off their booking page. */
  cancellationReasonPrivate?: boolean;
  cancelledAt?: Timestamp;
  /**
   * `system`: an unpaid checkout the site let go of by itself (Stripe
   * expired it, or the bank payment failed). Older ones say `admin`.
   */
  cancelledBy?: 'customer' | 'admin' | 'system';
  /** What the customer's own cancel refunded, not counting refunds Travis gave before it. */
  cancelRefundCents?: number;
  /**
   * Travis closed this departure and offered the customer another date or a
   * full refund instead of cancelling it. Cleared once they move.
   */
  closure?: BookingClosure;
  /**
   * Travis reopened the day after that offer and put the booking back on its
   * trip: the offer's `decideBy`. Until then (marina time, inclusive) a
   * customer cancel is refunded in full. Cleared when it moves, whoever moves it.
   */
  refundGraceUntil?: string;
  /** `date/timeSlot` the day-before reminder went out for. */
  reminderSentFor?: string;
  /** Emails to the customer that bounced, by kind (`confirmation`, `reminder`…). */
  emailBounces?: Record<string, EmailBounce>;
  /** When Travis was emailed about a bounce or delay of each kind. */
  bounceAlertSentAt?: Record<string, Timestamp>;
  /** The customer marked one of our emails as spam. */
  marketingSuppressed?: boolean;

  // ---- Customer self-service (token-authenticated, no login) ------------
  /** Random UUIDv4; gates `/my-booking/[id]?t=[token]`. */
  accessToken: string;
  /**
   * Hash of the visitor's IP address at checkout (never the address): how
   * createCheckoutSession limits one visitor's unpaid checkouts. Taken off
   * once the booking is paid or the checkout is let go.
   */
  checkoutIpHash?: string;

  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** See `functions/src/lib/types.ts`. */
export interface EmailBounce {
  emailId: string;
  to: string;
  subject: string;
  bounceType: string | null;
  bounceMessage: string | null;
  at: Timestamp;
}

/** See `functions/src/lib/types.ts`. */
export interface BookingClosure {
  blackoutId: string;
  /** What the customer was told, e.g. "Closed for weather". */
  reason: string;
  /** Last day to pick a new date (YYYY-MM-DD, marina time); after it, a full refund. */
  decideBy: string;
  offeredAt: Timestamp;
  /** When the pick-a-new-date email went out. */
  offerEmailedAt?: Timestamp;
  /** The one reminder the day before the deadline. */
  reminderSentAt?: Timestamp;
  /** Stripe turned down the refund the deadline was due to send: nothing changed, and Travis sorts it out. */
  refundRefused?: { at: Timestamp; refundCents: number; stripeMessage: string; alertedAt?: Timestamp };
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
/* Testimonials (admin-curated guest reviews)                                 */
/* -------------------------------------------------------------------------- */

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
  /** Optional location string, e.g. "Atlanta GA". */
  location: string | null;
  /** 1-5; null means "no rating, just the quote". */
  rating: number | null;
  source: TestimonialSource;
  /** Optional link back to the original review (Google, Tripadvisor, etc.). */
  sourceUrl: string | null;
  /** YYYY-MM-DD review date — used for display and ordering tie-breaks. */
  reviewedAt: string | null;
  /** Show on home page hero rotation. */
  featured: boolean;
  /** Show anywhere public. Admin can stash drafts by toggling this off. */
  published: boolean;
  /** Lower numbers appear first. Defaults to 100 if not set. */
  order: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
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
/* News posts written by grokbot (newsPosts/{slug})                           */
/* -------------------------------------------------------------------------- */

/** A photo copied from Drive into Storage (`public/news/<slug>/`). */
export interface NewsImage {
  url: string;
  storagePath: string;
  width: number;
  height: number;
  alt: string;
}

/**
 * Where a grokbot post stands:
 *  - `pending-review`: emailed to Travis, not on the site yet
 *  - `published`: Travis approved it; it's on /news
 *  - `hidden`: taken down in Admin → Blog after publishing
 *  - `declined`: Travis said no (his note goes back to grokbot)
 *  - `expired`: nobody reviewed it within REVIEW_WINDOW_DAYS
 */
export type NewsPostStatus = 'pending-review' | 'published' | 'hidden' | 'declined' | 'expired';

/**
 * A post grokbot submitted through the MCP `submit_blog_post` tool. The
 * posts migrated from WordPress stay in content/news; src/lib/news.ts
 * merges the published ones in. The doc id is the slug, which is also the
 * URL.
 */
export interface NewsPostDoc {
  slug: string;
  /** The on-page headline (H1). */
  title: string;
  /** The whole <title>, rendered as-is (no site-name suffix added). */
  seoTitle: string;
  description: string;
  focusKeyphrase: string;
  /** Body Markdown; its images point at `images[].url`. */
  markdown: string;
  /** 16:9, heads the post and is the social card. */
  hero: NewsImage;
  /** 4:3 and 1:1 crops of the hero, for Google's Article markup. */
  heroCrops: NewsImage[];
  images: NewsImage[];
  /** Drive photo ids used, so later posts pick fresh ones. */
  photoIds: string[];
  /**
   * Stored images deleted because Trip photos withdrew their photo, once the
   * post was off the website (deleteWithdrawnCopies in src/lib/blog-publish.ts).
   */
  removedImagePaths?: string[];
  status: NewsPostStatus;
  submittedAt: Timestamp;
  /** When Travis approved it; null until then. */
  publishedAt: Timestamp | null;
  updatedAt: Timestamp;
  /** SHA-256 of the review link's token; cleared once reviewed. */
  reviewTokenHash: string | null;
  reviewedAt: Timestamp | null;
  /** Who approved or declined it: an admin's email. */
  reviewedBy: string | null;
  /** What Travis asked to change when declining. */
  reviewNote: string | null;
  wordCount: number;
  seoScore: number;
  readabilityScore: number;
  checks: { id: string; rating: 'good' | 'ok' | 'problem' }[];
  author: 'grokbot';
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
  | 'review.send'
  | 'review.hold'
  | 'tripPhoto.delete'
  | 'crew.add'
  | 'crew.update'
  | 'crew.password'
  | 'crew.remove'
  | 'crew.trip'
  /** A new calendar link for a crew member (the old one stops working). */
  | 'crew.calendar'
  | 'post.submit'
  | 'post.approve'
  | 'post.decline'
  | 'post.hide'
  | 'post.show';

export interface AuditEntry {
  id: string;
  action: AuditAction;
  actorEmail: string;
  /**
   * `'mcp'` when the change came through the site's MCP endpoint;
   * `'scheduler'` when a scheduled job finished something an admin started.
   */
  via?: 'mcp' | 'scheduler';
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

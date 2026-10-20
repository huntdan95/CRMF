'use client';

import {
  collection,
  query,
  where,
  orderBy,
  limit as fbLimit,
  getDocs,
  getCountFromServer,
  doc,
  documentId,
  getDoc,
  onSnapshot,
  startAfter,
  type DocumentData,
  type QueryConstraint,
  type QueryDocumentSnapshot,
  type Unsubscribe,
} from 'firebase/firestore';
import { getDb, getFirebaseAuth } from './firebase/client';
import type { ClosureActionDoc } from './closure-types';

/**
 * Waits for Firebase Auth to restore its initial state. Required before
 * any Firestore read in admin pages — `onAuthStateChanged` may fire
 * milliseconds after first paint, and reads attempted before that fail
 * security rules.
 */
export async function adminAuthReady(): Promise<void> {
  await getFirebaseAuth().authStateReady();
  if (!getFirebaseAuth().currentUser) {
    throw new Error(
      'Not signed in to Firebase Auth. Sign out and sign back in.',
    );
  }
}

export interface BookingDoc {
  id: string;
  tourId: string;
  tourName: string;
  date: string;
  timeSlot: string;
  type: 'shared' | 'private';
  guestCount: number;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  guests: { name: string; age: number | null; wetsuitSize?: string | null }[];
  status:
    | 'pending-payment'
    | 'confirmed'
    | 'cancelled'
    | 'completed'
    | 'no-show';
  paymentStatus: 'pending' | 'paid' | 'refunded' | 'partial-refund' | 'failed';
  amountPaidCents: number;
  amountRefundedCents: number;
  /** Old-site money owed back on cancelling, for Travis to refund by hand; never in `amountRefundedCents`. */
  manualRefundCents?: number;
  /** When Travis recorded that he'd refunded `manualRefundCents` by hand; the amount stays. */
  manualRefundedAt?: { seconds: number; nanoseconds: number } | null;
  stripePaymentIntentId?: string;
  stripeCheckoutSessionId?: string;
  adminNotes?: string;
  cancellationReason?: string | null;
  /** Travis's own reason, given without emailing the customer: they don't see it. */
  cancellationReasonPrivate?: boolean;
  cancelledAt?: { seconds: number; nanoseconds: number } | null;
  cancelledBy?: 'customer' | 'admin' | 'system' | null;
  createdAt?: { seconds: number; nanoseconds: number } | null;
  updatedAt?: { seconds: number; nanoseconds: number } | null;
  confirmationEmailSentAt?: { seconds: number; nanoseconds: number } | null;
  postTourFollowupSentAt?: { seconds: number; nanoseconds: number } | null;
  /** The trip photos email went (sendTripPhotos). */
  photosSentAt?: { seconds: number; nanoseconds: number } | null;
  /** Travis is holding the review request to call first; it sends on its own at this time. */
  reviewHoldUntil?: { seconds: number; nanoseconds: number } | null;
  accessToken: string;
  /** Present on bookings imported from the old WordPress site. */
  legacy?: LegacyBookingInfo;
  /** Travis closed the departure and offered a new date or a refund; waiting on the customer. */
  closure?: {
    blackoutId: string;
    reason: string;
    decideBy: string;
    offerEmailedAt?: { seconds: number; nanoseconds: number } | null;
    reminderSentAt?: { seconds: number; nanoseconds: number } | null;
  } | null;
  /** Emails to the customer that bounced, by kind (from the Resend webhook). */
  emailBounces?: Record<string, EmailBounceDoc> | null;
  /** They marked one of our emails as spam; no "thanks for coming" email goes out by itself. */
  marketingSuppressed?: boolean;
}

/** One bounced email; see `EmailBounce` in functions/src/lib/types.ts. */
export interface EmailBounceDoc {
  emailId: string;
  /** The address it bounced from. */
  to: string;
  subject: string;
  /** Permanent, Transient or Undetermined (Resend's bounce.type). */
  bounceType: string | null;
  bounceMessage: string | null;
  at?: { seconds: number; nanoseconds: number } | null;
}

/** What scripts/import-legacy-bookings.ts keeps from the old site's export. */
export interface LegacyBookingInfo {
  source: string;
  bookingId: number;
  oldStatus: string;
  tourName: string;
  startTime: string | null;
  endTime: string | null;
  location: string | null;
  persons: string | null;
  orderIds: string | null;
  orderStatuses: string | null;
  couponCodes: string | null;
  paymentMethod: string | null;
  stripeTransactionIds: string | null;
  netPaidCents: number;
  bookedOn: string | null;
}

export interface BlackoutDoc {
  id: string;
  date: string;
  affectedSlots: string[];
  reason?: string | null;
  notes?: string | null;
  createdAt?: { seconds: number; nanoseconds: number } | null;
}

export interface RescheduleRequestDoc {
  id: string;
  bookingId: string;
  bookingCustomerEmail: string;
  bookingDate: string;
  bookingTimeSlot: string;
  requestedDate: string;
  requestedSlot: string | null;
  notes: string | null;
  status: 'open' | 'accepted' | 'declined' | 'resolved';
  /** Travis's own notes on the request, saved with its status (MCP's update_reschedule_request); the customer never sees them. */
  adminNotes?: string | null;
  createdAt?: { seconds: number; nanoseconds: number } | null;
}

function withId<T extends DocumentData>(snap: { id: string; data: () => T }): T & { id: string } {
  return { ...(snap.data() as T), id: snap.id };
}

export async function listBookingsBetween(
  startIso: string,
  endIso: string,
): Promise<BookingDoc[]> {
  await adminAuthReady();
  const q = query(
    collection(getDb(), 'bookings'),
    where('date', '>=', startIso),
    where('date', '<=', endIso),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => withId(d) as BookingDoc);
}

type BookingStatus = BookingDoc['status'];

/**
 * Bookings with these statuses on `from` (a tour date) or later, unsorted.
 * Bookings only go a year ahead, so this stays small.
 */
export async function listBookingsFrom(from: string, statuses: BookingStatus[]): Promise<BookingDoc[]> {
  await adminAuthReady();
  const snap = await getDocs(
    query(collection(getDb(), 'bookings'), where('status', 'in', statuses), where('date', '>=', from)),
  );
  return snap.docs.map((d) => withId(d) as BookingDoc);
}

/** One page of {@link listBookingsPage}. */
export interface BookingsPage {
  bookings: BookingDoc[];
  /** `before` for the next page; null once there's nothing older. */
  next: string | null;
}

/**
 * About `pageSize` bookings with these statuses (any, if left out) and a
 * tour date before `before` (if given), latest date first, unsorted within
 * a day. Always whole days: the page's last day is read to its end, so no
 * day shows only some of its bookings.
 */
export async function listBookingsPage(opts: {
  statuses?: BookingStatus[];
  before?: string | null;
  pageSize: number;
}): Promise<BookingsPage> {
  await adminAuthReady();
  const bookings = collection(getDb(), 'bookings');
  const byStatus = opts.statuses ? [where('status', 'in', opts.statuses)] : [];
  const snap = await getDocs(
    query(
      bookings,
      ...byStatus,
      ...(opts.before ? [where('date', '<', opts.before)] : []),
      orderBy('date', 'desc'),
      fbLimit(opts.pageSize),
    ),
  );
  const page = snap.docs.map((d) => withId(d) as BookingDoc);
  if (page.length < opts.pageSize) return { bookings: page, next: null };
  const lastDay = page[page.length - 1]!.date;
  const rest = await getDocs(query(bookings, ...byStatus, where('date', '==', lastDay)));
  const have = new Set(page.map((b) => b.id));
  return {
    bookings: [...page, ...rest.docs.filter((d) => !have.has(d.id)).map((d) => withId(d) as BookingDoc)],
    next: lastDay,
  };
}

/**
 * How many bookings have these statuses (any, if left out) and a tour date
 * from `from` (if given) and before `before` (if given). Counted by
 * Firestore without reading them: a read per thousand or so.
 */
export async function countBookings(opts: {
  statuses?: BookingStatus[];
  from?: string;
  before?: string;
}): Promise<number> {
  await adminAuthReady();
  const snap = await getCountFromServer(
    query(
      collection(getDb(), 'bookings'),
      ...(opts.statuses ? [where('status', 'in', opts.statuses)] : []),
      ...(opts.from ? [where('date', '>=', opts.from)] : []),
      ...(opts.before ? [where('date', '<', opts.before)] : []),
    ),
  );
  return snap.data().count;
}

/** These bookings, in no particular order. Any that don't exist are left out. */
export async function listBookingsById(ids: string[]): Promise<BookingDoc[]> {
  await adminAuthReady();
  const chunks: string[][] = [];
  // Firestore's `in` takes at most 30 values.
  for (let i = 0; i < ids.length; i += 30) chunks.push(ids.slice(i, i + 30));
  const snaps = await Promise.all(
    chunks.map((chunk) => getDocs(query(collection(getDb(), 'bookings'), where(documentId(), 'in', chunk)))),
  );
  return snaps.flatMap((s) => s.docs.map((d) => withId(d) as BookingDoc));
}

export async function getBooking(bookingId: string): Promise<BookingDoc | null> {
  await adminAuthReady();
  const snap = await getDoc(doc(getDb(), 'bookings', bookingId));
  if (!snap.exists()) return null;
  return withId(snap as unknown as { id: string; data: () => BookingDoc });
}

export function subscribeBooking(
  bookingId: string,
  cb: (booking: BookingDoc | null) => void,
): Unsubscribe {
  return onSnapshot(
    doc(getDb(), 'bookings', bookingId),
    (snap) => {
      if (!snap.exists()) {
        cb(null);
        return;
      }
      cb(withId(snap as unknown as { id: string; data: () => BookingDoc }));
    },
    // Permission denied (signed out) or offline for good: report "can't
    // open" rather than leaving the page on "Loading…" forever.
    (err) => {
      console.error('Booking listener failed', err);
      cb(null);
    },
  );
}

export async function listBlackoutsBetween(
  startIso: string,
  endIso: string,
): Promise<BlackoutDoc[]> {
  await adminAuthReady();
  const q = query(
    collection(getDb(), 'blackouts'),
    where('date', '>=', startIso),
    where('date', '<=', endIso),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => withId(d) as BlackoutDoc);
}

/**
 * Closed days still in their undo window or going out right now, soonest
 * first. Updates live, so the dashboard banner appears, counts down and
 * goes away without a reload.
 */
export function subscribePendingClosures(
  cb: (actions: ClosureActionDoc[]) => void,
  onError: () => void,
): Unsubscribe {
  let unsub: Unsubscribe = () => {};
  let stopped = false;
  adminAuthReady()
    .then(() => {
      if (stopped) return;
      unsub = onSnapshot(
        query(collection(getDb(), 'closureActions'), where('state', 'in', ['pending', 'finalizing'])),
        (snap) =>
          cb(
            snap.docs
              .map((d) => withId(d) as ClosureActionDoc)
              .sort((a, b) => a.finalizeAt.seconds - b.finalizeAt.seconds),
          ),
        (err) => {
          console.error('Pending closures listener failed', err);
          onError();
        },
      );
    })
    .catch(onError);
  return () => {
    stopped = true;
    unsub();
  };
}

/** One closed day's closure action: how it stands now, and what it did once it's done. */
export async function getClosureAction(blackoutId: string): Promise<ClosureActionDoc | null> {
  await adminAuthReady();
  const snap = await getDoc(doc(getDb(), 'closureActions', blackoutId));
  return snap.exists() ? (withId(snap as unknown as { id: string; data: () => ClosureActionDoc }) as ClosureActionDoc) : null;
}

export async function listAllBlackouts(): Promise<BlackoutDoc[]> {
  await adminAuthReady();
  const snap = await getDocs(
    query(collection(getDb(), 'blackouts'), orderBy('date', 'asc')),
  );
  return snap.docs.map((d) => withId(d) as BlackoutDoc);
}

export async function listAllTours(): Promise<{
  id: string;
  slug: string;
  name: string;
  description: string;
  pricePerPerson: number | null;
  flatPrice: number | null;
  active: boolean;
  included: string[];
  timeSlot: string;
  startTime: string;
  durationHours: number;
  type: 'shared' | 'private';
}[]> {
  await adminAuthReady();
  const snap = await getDocs(collection(getDb(), 'tours'));
  return snap.docs.map((d) => withId(d) as never);
}

export interface RateSeasonDoc {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  prices: Record<string, number>;
}

/** Every rate season, past ones included, soonest first. */
export async function listRateSeasons(): Promise<RateSeasonDoc[]> {
  await adminAuthReady();
  const snap = await getDocs(collection(getDb(), 'rateSeasons'));
  return snap.docs
    .map((d) => withId(d) as RateSeasonDoc)
    .map((s) => ({ ...s, prices: s.prices ?? {} }))
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
}

export async function listAllRescheduleRequests(): Promise<RescheduleRequestDoc[]> {
  await adminAuthReady();
  const snap = await getDocs(
    query(
      collection(getDb(), 'rescheduleRequests'),
      orderBy('createdAt', 'desc'),
      fbLimit(100),
    ),
  );
  return snap.docs.map((d) => withId(d) as RescheduleRequestDoc);
}

export interface ContactMessageDoc {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  subject: string | null;
  message: string;
  status: 'new' | 'replied' | 'archived';
  createdAt?: { seconds: number; nanoseconds: number } | null;
  updatedAt?: { seconds: number; nanoseconds: number } | null;
}

export async function listAllContactMessages(): Promise<ContactMessageDoc[]> {
  await adminAuthReady();
  const snap = await getDocs(
    query(
      collection(getDb(), 'contactMessages'),
      orderBy('createdAt', 'desc'),
      fbLimit(200),
    ),
  );
  return snap.docs.map((d) => withId(d) as ContactMessageDoc);
}

/** A "Tell Travis privately" message (functions/src/feedback.ts). */
export interface GuestFeedbackDoc {
  id: string;
  bookingId: string;
  message: string;
  createdAt?: { seconds: number; nanoseconds: number } | null;
}

/**
 * A booking's private feedback, oldest first. At most five per booking,
 * so they're sorted here rather than needing an index.
 */
export async function listGuestFeedback(bookingId: string): Promise<GuestFeedbackDoc[]> {
  await adminAuthReady();
  const snap = await getDocs(
    query(collection(getDb(), 'guestFeedback'), where('bookingId', '==', bookingId)),
  );
  return snap.docs
    .map((d) => withId(d) as GuestFeedbackDoc)
    .sort((a, b) => (a.createdAt?.seconds ?? 0) - (b.createdAt?.seconds ?? 0));
}

export interface AuditEntryDoc {
  id: string;
  action: string;
  actorEmail: string;
  via?: 'mcp' | 'scheduler';
  targetId: string;
  payload: Record<string, unknown>;
  createdAt?: { seconds: number; nanoseconds: number } | null;
}

/** Where the next (older) page of the audit log starts. */
export type AuditCursor = QueryDocumentSnapshot<DocumentData>;

/** Newest entries first; pass the returned `next` to get the ones before them. */
export async function listRecentAuditLog(
  after: AuditCursor | null = null,
  pageSize = 100,
): Promise<{ entries: AuditEntryDoc[]; next: AuditCursor | null }> {
  await adminAuthReady();
  const snap = await getDocs(
    query(
      collection(getDb(), 'auditLog'),
      orderBy('createdAt', 'desc'),
      ...(after ? [startAfter(after)] : []),
      fbLimit(pageSize),
    ),
  );
  return {
    entries: snap.docs.map((d) => withId(d) as AuditEntryDoc),
    next: snap.docs.length === pageSize ? snap.docs[snap.docs.length - 1]! : null,
  };
}

export async function listAllTestimonials(): Promise<
  Array<{
    id: string;
    quote: string;
    author: string;
    location: string | null;
    rating: number | null;
    source:
      | 'google'
      | 'tripadvisor'
      | 'facebook'
      | 'instagram'
      | 'direct'
      | 'other';
    sourceUrl: string | null;
    reviewedAt: string | null;
    featured: boolean;
    published: boolean;
    order: number;
    createdAt?: { seconds: number; nanoseconds: number } | null;
    updatedAt?: { seconds: number; nanoseconds: number } | null;
  }>
> {
  await adminAuthReady();
  const snap = await getDocs(collection(getDb(), 'testimonials'));
  return snap.docs
    .map((d) => withId(d) as never)
    .sort(
      (a: { order: number }, b: { order: number }) =>
        (a.order ?? 100) - (b.order ?? 100),
    );
}

export interface CrewMemberDoc {
  id: string;
  name: string;
  /** Missing on crew added before roles; treat as a mate. */
  role?: 'captain' | 'mate';
  /** Null until Travis adds one: no crew emails, no app sign-in. */
  email: string | null;
  phone?: string | null;
  /** Crew emails. Missing means on. */
  alertsOn?: boolean;
  createdAt?: { seconds: number; nanoseconds: number } | null;
  passwordSetAt?: { seconds: number; nanoseconds: number } | null;
  lastSignInAt?: { seconds: number; nanoseconds: number } | null;
  /** Their calendar link was last sent or made (the link itself is never stored). */
  calendarLinkIssuedAt?: { seconds: number; nanoseconds: number } | null;
}

/** Crew members, each with how many phones have notifications on. */
export async function listCrewMembers(): Promise<
  Array<CrewMemberDoc & { pushDevices: number }>
> {
  await adminAuthReady();
  const [crewSnap, subsSnap] = await Promise.all([
    getDocs(query(collection(getDb(), 'crew'), orderBy('createdAt', 'asc'))),
    getDocs(collection(getDb(), 'crewPushSubscriptions')),
  ]);
  const devices = new Map<string, number>();
  for (const d of subsSnap.docs) {
    const crewId = d.get('crewId') as string;
    devices.set(crewId, (devices.get(crewId) ?? 0) + 1);
  }
  return crewSnap.docs.map((d) => ({
    ...(withId(d) as CrewMemberDoc),
    pushDevices: devices.get(d.id) ?? 0,
  }));
}

/** One departure (date + time slot) with guests going, for deciding who crews it. */
export interface UpcomingTrip {
  /** `YYYY-MM-DD_<timeSlot>`, the same id as trip photos and `soloTrips`. */
  id: string;
  date: string;
  timeSlot: string;
  tourId: string;
  tourName: string;
  type: BookingDoc['type'];
  guests: number;
  bookings: number;
  /** Old-site bookings with no party size on file: `guests` leaves them out. */
  unknownPartyBookings: number;
  /** Travis is running it without crew. */
  noCrew: boolean;
}

/**
 * Departures from `today` (marina date) on, by the crew schedule's rule:
 * confirmed bookings, plus old-site bookings held with a deposit. A new-site
 * `pending-payment` is someone still in Stripe checkout. Unsorted.
 */
export async function listUpcomingTrips(today: string): Promise<UpcomingTrip[]> {
  await adminAuthReady();
  const [bookingSnap, soloSnap] = await Promise.all([
    getDocs(
      query(
        collection(getDb(), 'bookings'),
        where('status', 'in', ['confirmed', 'pending-payment']),
        where('date', '>=', today),
      ),
    ),
    getDocs(query(collection(getDb(), 'soloTrips'), where('date', '>=', today))),
  ]);
  const solo = new Set(soloSnap.docs.map((d) => d.id));
  const trips = new Map<string, UpcomingTrip>();
  for (const d of bookingSnap.docs) {
    const b = withId(d) as BookingDoc;
    if (b.status === 'pending-payment' && !b.legacy && !b.id.startsWith('legacy-')) continue;
    const id = `${b.date}_${b.timeSlot}`;
    const known = b.guestCount > 0 ? b.guestCount : 0;
    const trip = trips.get(id);
    if (trip) {
      trip.guests += known;
      trip.bookings += 1;
      if (!known) trip.unknownPartyBookings += 1;
    } else {
      trips.set(id, {
        id,
        date: b.date,
        timeSlot: b.timeSlot,
        tourId: b.tourId,
        tourName: b.tourName,
        type: b.type,
        guests: known,
        bookings: 1,
        unknownPartyBookings: known ? 0 : 1,
        noCrew: solo.has(id),
      });
    }
  }
  return [...trips.values()];
}

export interface SiteSettingsDoc {
  cancellationPolicyText?: string;
  contactEmail?: string;
  /** Minutes to undo closing a day before anything goes out (functions/src/lib/close-day.ts). */
  closureUndoMinutes?: number;
  googleReviewUrl?: string;
  wetsuitSizes?: { adult: string[]; kids: string[] };
}

export interface TripPhotosDoc {
  id: string;
  date: string;
  timeSlot: string;
  uploadToken?: string;
  photoCount?: number;
  lastUploadAt?: { seconds: number; nanoseconds: number } | null;
  folderUrl?: string | null;
}

export interface TripFileDoc {
  id: string;
  storagePath: string;
  name: string;
  contentType: string;
  size: number;
  downloadToken: string;
  uploadedAt?: { seconds: number; nanoseconds: number } | null;
  drive?: {
    status: 'pending' | 'copied' | 'failed' | 'not-connected';
    fileId?: string | null;
    error?: string | null;
    attempts?: number;
  };
}

/** One departure's photo record and its files, oldest upload first. */
export async function getTripPhotos(
  tripId: string,
): Promise<{ trip: TripPhotosDoc | null; files: TripFileDoc[] }> {
  await adminAuthReady();
  const tripRef = doc(getDb(), 'tripPhotos', tripId);
  const [trip, files] = await Promise.all([
    getDoc(tripRef),
    getDocs(query(collection(tripRef, 'files'), orderBy('uploadedAt', 'asc'))),
  ]);
  return {
    trip: trip.exists() ? (withId(trip as unknown as { id: string; data: () => TripPhotosDoc }) as TripPhotosDoc) : null,
    files: files.docs.map((d) => withId(d) as TripFileDoc),
  };
}

/** Photo records for departures between two dates (inclusive). */
export async function listTripPhotosBetween(startIso: string, endIso: string): Promise<TripPhotosDoc[]> {
  await adminAuthReady();
  const snap = await getDocs(
    query(collection(getDb(), 'tripPhotos'), where('date', '>=', startIso), where('date', '<=', endIso)),
  );
  return snap.docs.map((d) => withId(d) as TripPhotosDoc);
}

export async function getSiteSettings(): Promise<SiteSettingsDoc | null> {
  await adminAuthReady();
  const snap = await getDoc(doc(getDb(), 'settings', 'site'));
  if (!snap.exists()) return null;
  return snap.data() as SiteSettingsDoc;
}

export { type QueryConstraint };

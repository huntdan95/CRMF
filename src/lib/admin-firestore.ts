'use client';

import {
  collection,
  query,
  where,
  orderBy,
  limit as fbLimit,
  getDocs,
  doc,
  getDoc,
  onSnapshot,
  startAfter,
  type DocumentData,
  type QueryConstraint,
  type QueryDocumentSnapshot,
  type Unsubscribe,
} from 'firebase/firestore';
import { getDb, getFirebaseAuth } from './firebase/client';

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
  stripePaymentIntentId?: string;
  stripeCheckoutSessionId?: string;
  adminNotes?: string;
  cancellationReason?: string | null;
  cancelledAt?: { seconds: number; nanoseconds: number } | null;
  cancelledBy?: 'customer' | 'admin' | null;
  createdAt?: { seconds: number; nanoseconds: number } | null;
  updatedAt?: { seconds: number; nanoseconds: number } | null;
  confirmationEmailSentAt?: { seconds: number; nanoseconds: number } | null;
  postTourFollowupSentAt?: { seconds: number; nanoseconds: number } | null;
  accessToken: string;
  /** Present on bookings imported from the old WordPress site. */
  legacy?: LegacyBookingInfo;
  /** Travis closed the departure and offered a new date or a refund; waiting on the customer. */
  closure?: { blackoutId: string; reason: string; decideBy: string } | null;
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

// High enough to hold every booking, including the ~970 imported from the
// old site: search and the status filter only see what this loads.
const ALL_BOOKINGS_LIMIT = 5000;

export async function listAllBookings(): Promise<BookingDoc[]> {
  await adminAuthReady();
  const q = query(
    collection(getDb(), 'bookings'),
    orderBy('createdAt', 'desc'),
    fbLimit(ALL_BOOKINGS_LIMIT),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => withId(d) as BookingDoc);
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

export interface AuditEntryDoc {
  id: string;
  action: string;
  actorEmail: string;
  via?: 'mcp';
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
  email: string;
  createdAt?: { seconds: number; nanoseconds: number } | null;
  passwordSetAt?: { seconds: number; nanoseconds: number } | null;
  lastSignInAt?: { seconds: number; nanoseconds: number } | null;
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

export async function getSiteSettings(): Promise<{
  cancellationPolicyText?: string;
  contactEmail?: string;
} | null> {
  await adminAuthReady();
  const snap = await getDoc(doc(getDb(), 'settings', 'site'));
  if (!snap.exists()) return null;
  return snap.data() as { cancellationPolicyText?: string; contactEmail?: string };
}

export { type QueryConstraint };

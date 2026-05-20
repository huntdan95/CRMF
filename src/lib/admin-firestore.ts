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
  type DocumentData,
  type QueryConstraint,
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
  accessToken: string;
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

export async function listAllBookings(): Promise<BookingDoc[]> {
  await adminAuthReady();
  const q = query(
    collection(getDb(), 'bookings'),
    orderBy('createdAt', 'desc'),
    fbLimit(500),
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
  return onSnapshot(doc(getDb(), 'bookings', bookingId), (snap) => {
    if (!snap.exists()) {
      cb(null);
      return;
    }
    cb(withId(snap as unknown as { id: string; data: () => BookingDoc }));
  });
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

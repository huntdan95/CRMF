'use client';

import {
  collection,
  getDocs,
  onSnapshot,
  query,
  where,
  type Unsubscribe,
} from 'firebase/firestore';
import { getDb } from './firebase/client';
import { adminAuthReady } from './admin-firestore';

/** A signed waiver as the admin reads it (see src/lib/waiver/types.ts). */
export interface WaiverDoc {
  id: string;
  bookingId: string;
  tripId: string;
  tripDate: string;
  timeSlot: string;
  tourName: string;
  version: string;
  includesMinorAddendum: boolean;
  signer: {
    name: string;
    dob: string;
    email: string;
    phone: string;
    address: string;
    participating: boolean;
    rosterName: string | null;
  };
  minors: Array<{ name: string; dob: string; ageOnTripDate: number; rosterName: string | null }>;
  accompanyingAdult: string | null;
  guardianAttested: boolean;
  signatureMethod: 'drawn' | 'typed';
  signedAt?: { seconds: number; nanoseconds: number } | null;
  emailedAt?: { seconds: number; nanoseconds: number } | null;
}

function toWaiver(d: { id: string; data: () => unknown }): WaiverDoc {
  return { ...(d.data() as WaiverDoc), id: d.id };
}

function bySignedAt(a: WaiverDoc, b: WaiverDoc) {
  return (a.signedAt?.seconds ?? 0) - (b.signedAt?.seconds ?? 0);
}

/** Live list of a booking's signed waivers, oldest first. */
export function subscribeWaiversForBooking(
  bookingId: string,
  cb: (waivers: WaiverDoc[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  const q = query(collection(getDb(), 'waivers'), where('bookingId', '==', bookingId));
  return onSnapshot(
    q,
    (snap) => cb(snap.docs.map(toWaiver).sort(bySignedAt)),
    (err) => onError?.(err),
  );
}

/**
 * Signed waivers for these bookings. Looked up by booking, not by the
 * waiver's `tripDate`: that's frozen at signing, and a booking Travis moves
 * to another day keeps its waivers.
 */
export async function listWaiversForBookings(bookingIds: string[]): Promise<WaiverDoc[]> {
  await adminAuthReady();
  const ids = [...new Set(bookingIds)];
  const chunks: string[][] = [];
  // Firestore's `in` takes at most 30 values.
  for (let i = 0; i < ids.length; i += 30) chunks.push(ids.slice(i, i + 30));
  const snaps = await Promise.all(
    chunks.map((chunk) =>
      getDocs(query(collection(getDb(), 'waivers'), where('bookingId', 'in', chunk))),
    ),
  );
  return snaps.flatMap((s) => s.docs.map(toWaiver)).sort(bySignedAt);
}

export function signedAtLabel(w: WaiverDoc): string {
  if (!w.signedAt) return '';
  return new Date(w.signedAt.seconds * 1000).toLocaleString('en-US', {
    timeZone: 'America/New_York',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

import { randomBytes } from 'node:crypto';

import { db, FieldValue, Timestamp } from './firebase';
import { addDays, zonedTimeToUtc } from './datetime';
import type { TourTimeSlot } from './types';

/*
 * Trip photos. A trip is one departure, `YYYY-MM-DD_<timeSlot>`: every
 * booking on the same boat at the same time, so every party on a shared
 * tour sees the same gallery (the owner confirmed that's fine).
 *
 *   tripPhotos/{tripId}              uploadToken, photo count, last upload, Drive folder — admin-readable
 *   tripPhotos/{tripId}/files/{id}   one per upload: path, type, size, download token, Drive copy
 *   tripUploadTokens/{token}         tripId + expiresAt — server-only; storage.rules checks it
 *   trips/{tripId}/<file>            the photos and videos, in Firebase Storage
 *
 * The crew upload with a no-login link, /upload/<token>, that stops
 * working 7 days after the trip. The same layout is written by the website
 * (src/lib/trip-photos-server.ts); keep the two in sync.
 */

/** Uploads stop being accepted this many days after the trip. */
export const UPLOAD_WINDOW_DAYS = 7;

export function tripIdFor(date: string, timeSlot: TourTimeSlot | string): string {
  return `${date}_${timeSlot}`;
}

export function parseTripId(id: string): { date: string; timeSlot: TourTimeSlot } | null {
  const m = /^(\d{4}-\d{2}-\d{2})_([a-z-]+)$/.exec(id);
  return m ? { date: m[1]!, timeSlot: m[2] as TourTimeSlot } : null;
}

/** When the upload link stops working: the end of the 7th day after the trip, marina time. */
export function uploadExpiresAt(date: string): Date {
  return zonedTimeToUtc(addDays(date, UPLOAD_WINDOW_DAYS + 1), '00:00');
}

export function uploadUrl(baseUrl: string, token: string): string {
  return `${baseUrl}/upload/${token}`;
}

/**
 * The departure's upload token, made on first use. Safe to call from two
 * places at once: the transaction keeps the first token.
 */
export async function ensureUploadToken(date: string, timeSlot: TourTimeSlot): Promise<{ tripId: string; token: string }> {
  const tripId = tripIdFor(date, timeSlot);
  const ref = db.collection('tripPhotos').doc(tripId);
  const existing = (await ref.get()).get('uploadToken') as string | undefined;
  if (existing) return { tripId, token: existing };

  const candidate = randomBytes(24).toString('base64url');
  const token = await db.runTransaction(async (tx) => {
    const current = (await tx.get(ref)).get('uploadToken') as string | undefined;
    if (current) return current;
    tx.set(
      ref,
      { date, timeSlot, uploadToken: candidate, photoCount: 0, createdAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
    tx.set(db.collection('tripUploadTokens').doc(candidate), {
      tripId,
      expiresAt: Timestamp.fromDate(uploadExpiresAt(date)),
    });
    return candidate;
  });
  return { tripId, token };
}

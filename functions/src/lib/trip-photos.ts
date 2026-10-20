import { randomBytes } from 'node:crypto';

import { db, FieldValue, Timestamp } from './firebase';
import { APP_BASE_URL } from './config';
import { customerMailer } from './customer-mailer';
import { addDays, zonedTimeToUtc } from './datetime';
import type { EmailDeps } from './email-log';
import { buildTripPhotosEmail, galleryUrl } from './guest-templates';
import { isGoingAhead, type Booking, type TourTimeSlot } from './types';

/*
 * Trip photos. A trip is one departure, `YYYY-MM-DD_<timeSlot>`: every
 * booking on the same boat at the same time, so every party on a shared
 * tour sees the same gallery (the owner confirmed that's fine).
 *
 *   tripPhotos/{tripId}              uploadToken, photo count, last upload, Drive folder, withdrawn Drive copies — admin-readable
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
 * Files bigger than this download straight from Storage, one at a time,
 * and aren't in the gallery's "Download all" zip: Cloud Run (under App
 * Hosting) won't send a response over 32 MiB that says its length, and a
 * zip of GoPro videos wouldn't finish inside App Hosting's 5-minute request
 * limit. Videos always go that way. The same rule is in
 * src/lib/trip-photos-server.ts.
 */
export const DIRECT_DOWNLOAD_BYTES = 25 * 1024 * 1024;

export function downloadsOneAtATime(f: { contentType: string; size: number }): boolean {
  return f.contentType.startsWith('video/') || f.size > DIRECT_DOWNLOAD_BYTES;
}

/**
 * Content-Disposition that saves a file under `name`, with an ASCII
 * fallback for a browser that ignores `filename*` (attachment() in
 * src/lib/trip-photo-download.ts is the same).
 */
export function attachmentDisposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  // encodeURIComponent leaves these as they are; in `filename*` they have to be encoded.
  const encoded = encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
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

/**
 * Guests who went out on the boat, as the gallery counts them (onTheBoat in
 * src/lib/trip-photos-server.ts): confirmed or completed, or an old-site
 * deposit, and not still `closure`d on a departure Travis called off.
 */
export function onTheBoat(b: Pick<Booking, 'id' | 'legacy' | 'status' | 'closure'>): boolean {
  if (b.closure && b.status !== 'completed') return false;
  return b.status === 'completed' || isGoingAhead(b);
}

/** A blog post's photos and its own stored copies of them (`newsPosts/{slug}`). */
export interface StoredPhotos {
  photoIds?: string[];
  hero?: { storagePath: string } | null;
  heroCrops?: Array<{ storagePath: string }>;
  images?: Array<{ storagePath: string }>;
}

/**
 * The Storage paths of a blog post's own copies of the given Drive photos,
 * as storedCopiesOf in src/lib/blog-rules.ts works them out (keep the two
 * the same): `photoIds` lists the hero's photo first, then the body photos
 * in order, so the first is the hero and its crops and each of the rest is
 * the body image in the same place. A post whose lists don't line up that
 * way gives every copy it has, rather than miss one.
 */
export function storedCopiesOf(post: StoredPhotos, driveIds: Iterable<string>): string[] {
  const wanted = new Set(driveIds);
  const ids = post.photoIds ?? [];
  const hero = [post.hero, ...(post.heroCrops ?? [])].flatMap((i) => (i ? [i.storagePath] : []));
  const body = (post.images ?? []).map((i) => i.storagePath);
  const paths =
    ids.length !== body.length + 1
      ? ids.some((id) => wanted.has(id))
        ? [...hero, ...body]
        : []
      : ids.flatMap((id, i) => (!wanted.has(id) ? [] : i === 0 ? hero : [body[i - 1]!]));
  return [...new Set(paths)];
}

/**
 * The photos email again, for admin's "Fix email and resend" and "Reset
 * their booking links": the gallery link is made from the booking's token
 * as it is now, and it goes to the address on the booking now, copied to
 * Travis. Skipped if the booking didn't go out or the gallery has nothing in
 * it (Travis deleted them all, or uploads came from the old Drive-only
 * uploader). Throws if Resend refuses it.
 */
export async function resendTripPhotosEmail(
  booking: Booking,
  opts: { adminEmail: string; idempotencyKey: string; deps?: EmailDeps },
): Promise<{ sent: true } | { sent: false; skipped: 'not-on-boat' | 'no-photos' }> {
  const url = galleryUrl(APP_BASE_URL.value(), booking);
  if (!onTheBoat(booking) || !url) return { sent: false, skipped: 'not-on-boat' };
  const trip = (await (opts.deps?.db ?? db).collection('tripPhotos').doc(tripIdFor(booking.date, booking.timeSlot)).get()).data();
  const count = (trip?.photoCount as number | undefined) ?? 0;
  if (!trip?.uploadToken || count <= 0) return { sent: false, skipped: 'no-photos' };

  const { subject, html, text } = buildTripPhotosEmail({ booking, galleryUrl: url, count });
  await customerMailer({ adminEmail: opts.adminEmail, deps: opts.deps }).send({
    kind: 'photos',
    bookingId: booking.id,
    to: booking.customerEmail,
    subject,
    html,
    text,
    idempotencyKey: opts.idempotencyKey,
  });
  return { sent: true };
}

import 'server-only';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { adminDb } from './firebase/admin';
import { blackoutCovers } from './closed-departures';
import { isValidIsoDate } from './date';
import { galleryKey } from './gallery-link';
import { formatClock, slotLabels, type TourTimeSlot, type TourType } from './tours';
import { SLOT_MINUTES, slotStartMinutes } from './schedule';
import { storageFileUrl } from './storage-url';

/*
 * Trip photos, website side. The crew upload from a no-login link,
 * /upload/<token>, straight to Firebase Storage (storage.rules checks the
 * token). A Cloud Function records each file and copies it to Google Drive
 * (functions/src/lib/google-drive.ts), where the blog's photo picker finds
 * them (src/lib/blog-photos.ts); guests see their departure's photos at
 * /my-booking/<id>/photos. Layout (keep in sync with
 * functions/src/lib/trip-photos.ts):
 *
 *   tripPhotos/{tripId}              uploadToken, photoCount, lastUploadAt, folderId, folderUrl, withdrawnDriveIds
 *   tripPhotos/{tripId}/files/{id}   storagePath, name, contentType, size, downloadToken, attachment
 *   tripUploadTokens/{token}         tripId, expiresAt
 *
 * A trip is one departure, `YYYY-MM-DD_<timeSlot>`: every booking on the
 * same boat at the same time.
 */

/** Uploads stop being accepted this many days after the trip. */
export const UPLOAD_WINDOW_DAYS = 7;

/** How far back the crew app lists trips to upload to. */
export const RECENT_TRIP_DAYS = 7;

/**
 * Bookings whose guests actually went out (no-shows and cancellations don't
 * get photos). Old-site bookings held with a deposit were imported as
 * `pending-payment`; a new-site one is an abandoned checkout. A booking
 * still `closure`d is on a departure Travis called off: it didn't go out.
 */
function onTheBoat(id: string, status: string, closure?: unknown): boolean {
  if (closure && status !== 'completed') return false;
  return (
    status === 'confirmed' ||
    status === 'completed' ||
    (status === 'pending-payment' && id.startsWith('legacy-'))
  );
}

export function tripId(date: string, timeSlot: string): string {
  return `${date}_${timeSlot}`;
}

export function parseTripId(id: string): { date: string; timeSlot: TourTimeSlot } | null {
  const [date, timeSlot, extra] = id.split('_');
  if (extra !== undefined || !date || !timeSlot) return null;
  // Own keys only: `in` would also take "constructor" and the like.
  if (!isValidIsoDate(date) || !Object.hasOwn(slotLabels, timeSlot)) return null;
  return { date, timeSlot: timeSlot as TourTimeSlot };
}

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + days)).toISOString().slice(0, 10);
}

/** Midnight marina time at the start of `date`, as a UTC instant. */
function marinaMidnight(date: string): Date {
  // Eastern is UTC-4 or -5; try both and keep the one that reads midnight.
  for (const offset of [4, 5]) {
    const guess = new Date(`${date}T${String(offset).padStart(2, '0')}:00:00Z`);
    const hour = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour: 'numeric',
      hourCycle: 'h23',
    }).format(guess);
    if (hour === '0') return guess;
  }
  return new Date(`${date}T05:00:00Z`);
}

/** When the upload link stops working: the end of the 7th day after the trip. */
export function uploadExpiresAt(date: string): Date {
  return marinaMidnight(addDays(date, UPLOAD_WINDOW_DAYS + 1));
}

/** From the schedule: the sunset cruise leaves at a different time each day. */
function startMinutes(timeSlot: TourTimeSlot, date: string): number {
  return timeSlot in SLOT_MINUTES ? slotStartMinutes(timeSlot, date) : 0;
}

/** "10:30 AM" on `date`. */
export function departureTimeOf(timeSlot: TourTimeSlot, date: string): string {
  return timeSlot in SLOT_MINUTES ? formatClock(slotStartMinutes(timeSlot, date)) : slotLabels[timeSlot];
}

/* -------------------------------------------------------------------------- */
/* Upload links                                                               */
/* -------------------------------------------------------------------------- */

/** The departure's upload token, made on first use (same as the functions' ensureUploadToken). */
export async function ensureUploadToken(date: string, timeSlot: TourTimeSlot): Promise<string> {
  const db = adminDb();
  const id = tripId(date, timeSlot);
  const ref = db.collection('tripPhotos').doc(id);
  const existing = (await ref.get()).get('uploadToken') as string | undefined;
  if (existing) return existing;

  const candidate = randomBytes(24).toString('base64url');
  return db.runTransaction(async (tx) => {
    const current = (await tx.get(ref)).get('uploadToken') as string | undefined;
    if (current) return current;
    tx.set(
      ref,
      { date, timeSlot, uploadToken: candidate, photoCount: 0, createdAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
    tx.set(db.collection('tripUploadTokens').doc(candidate), {
      tripId: id,
      expiresAt: Timestamp.fromDate(uploadExpiresAt(date)),
    });
    return candidate;
  });
}

export interface UploadTrip {
  tripId: string;
  date: string;
  timeSlot: TourTimeSlot;
  tourName: string | null;
  type: TourType | null;
  guests: number;
  /** Old-site bookings on it with no party size, not in `guests`. */
  unknownParty: number;
  photoCount: number;
  /** Uploads are accepted until this time (ms). */
  expiresAt: number;
  /** Still taking uploads. */
  open: boolean;
}

/** The trip an upload link is for, or null if the link is wrong. */
export async function tripForUploadToken(token: string): Promise<UploadTrip | null> {
  if (!/^[\w-]{20,64}$/.test(token)) return null;
  const db = adminDb();
  const link = await db.collection('tripUploadTokens').doc(token).get();
  if (!link.exists) return null;
  const id = link.get('tripId') as string;
  const parsed = parseTripId(id);
  if (!parsed) return null;
  const [trip, bookings] = await Promise.all([
    db.collection('tripPhotos').doc(id).get(),
    tripBookings(parsed.date, parsed.timeSlot),
  ]);
  return {
    tripId: id,
    ...parsed,
    tourName: bookings[0]?.tourName ?? null,
    type: bookings[0]?.type ?? null,
    guests: bookings.reduce((s, b) => s + (b.guestCount ?? 0), 0),
    unknownParty: bookings.filter((b) => !(b.guestCount > 0)).length,
    photoCount: (trip.get('photoCount') as number | undefined) ?? 0,
    expiresAt: (link.get('expiresAt') as Timestamp).toMillis(),
    open: Date.now() < (link.get('expiresAt') as Timestamp).toMillis(),
  };
}

/* -------------------------------------------------------------------------- */
/* Trips for the crew app                                                     */
/* -------------------------------------------------------------------------- */

export interface RecentTrip {
  id: string;
  date: string;
  timeSlot: TourTimeSlot;
  tourId: string;
  type: TourType;
  /** Guests on file. `unknownParty`: old-site bookings on it with no party size, not in `guests`. */
  guests: number;
  unknownParty: number;
  photoCount: number;
  uploadToken: string;
}

interface BookingRow {
  id: string;
  date: string;
  timeSlot: TourTimeSlot;
  tourId: string;
  tourName: string;
  type: TourType;
  guestCount: number;
  status: string;
  closure?: unknown;
}

/** The bookings on a trip's boat; empty if the trip doesn't exist. */
async function tripBookings(date: string, timeSlot: TourTimeSlot): Promise<BookingRow[]> {
  const snap = await adminDb().collection('bookings').where('date', '==', date).get();
  return snap.docs
    .map((d) => ({ ...(d.data() as Omit<BookingRow, 'id'>), id: d.id }))
    .filter((b) => b.timeSlot === timeSlot && onTheBoat(b.id, b.status, b.closure));
}

/**
 * Departures from the last {@link RECENT_TRIP_DAYS} days that have left
 * the dock (today's only once their start time has passed), newest first,
 * each with its upload link token and photo count. Not one Travis closed
 * and left them booked on (a blackout covers it): it didn't run, as the
 * 8 PM schedule says, unless he's marked it completed since.
 */
export async function fetchRecentTrips(now: { date: string; minutes: number }): Promise<RecentTrip[]> {
  const db = adminDb();
  const from = addDays(now.date, -RECENT_TRIP_DAYS);
  const [snap, blackouts] = await Promise.all([
    db
      .collection('bookings')
      .where('date', '>=', from)
      .where('date', '<=', now.date)
      .select('date', 'timeSlot', 'tourId', 'type', 'guestCount', 'status', 'closure.blackoutId')
      .get(),
    db.collection('blackouts').where('date', '>=', from).where('date', '<=', now.date).get(),
  ]);
  const closed = (date: string, slot: string) =>
    blackouts.docs.some((d) => d.get('date') === date && blackoutCovers((d.get('affectedSlots') as string[]) ?? [], slot));

  const trips = new Map<string, Omit<RecentTrip, 'photoCount' | 'uploadToken'>>();
  for (const doc of snap.docs) {
    const b = doc.data() as Omit<BookingRow, 'id'>;
    if (!onTheBoat(doc.id, b.status, b.closure)) continue;
    if (b.status !== 'completed' && closed(b.date, b.timeSlot)) continue;
    if (b.date === now.date && startMinutes(b.timeSlot, b.date) > now.minutes) continue;
    const id = tripId(b.date, b.timeSlot);
    const trip = trips.get(id) ?? { id, date: b.date, timeSlot: b.timeSlot, tourId: b.tourId, type: b.type, guests: 0, unknownParty: 0 };
    if (b.guestCount > 0) trip.guests += b.guestCount;
    else trip.unknownParty += 1;
    trips.set(id, trip);
  }

  const out = await Promise.all(
    [...trips.values()].map(async (trip): Promise<RecentTrip> => {
      const uploadToken = await ensureUploadToken(trip.date, trip.timeSlot);
      const photoCount = ((await db.collection('tripPhotos').doc(trip.id).get()).get('photoCount') as number) ?? 0;
      return { ...trip, uploadToken, photoCount };
    }),
  );
  return out.sort(
    (a, b) =>
      b.date.localeCompare(a.date) ||
      startMinutes(b.timeSlot, b.date) - startMinutes(a.timeSlot, a.date),
  );
}

/* -------------------------------------------------------------------------- */
/* Guest gallery                                                              */
/* -------------------------------------------------------------------------- */

export interface GalleryFile {
  id: string;
  name: string;
  contentType: string;
  size: number;
  /** Shows the file in the browser; a capability URL, no sign-in needed. */
  url: string;
  /**
   * `url` saves it under `name` instead of opening it: Storage hands it out
   * as an attachment. Videos and big files, once the Cloud Function that
   * records uploads started setting that; older ones don't have it.
   */
  attachment: boolean;
}

/**
 * Files bigger than this aren't sent through the website: "Download all"
 * leaves them out, and each downloads on its own, straight from Storage
 * once it can. Cloud Run (under App Hosting) won't send a response over
 * 32 MiB that says its length, and a zip of GoPro videos wouldn't finish
 * inside App Hosting's 5-minute request limit. Videos always go that way.
 * The same rule is in functions/src/lib/trip-photos.ts.
 */
export const DIRECT_DOWNLOAD_BYTES = 25 * 1024 * 1024;

export function downloadsOneAtATime(f: { contentType: string; size: number }): boolean {
  return f.contentType.startsWith('video/') || f.size > DIRECT_DOWNLOAD_BYTES;
}

/**
 * Whether the gallery shows it as a photo: a thumbnail that opens full
 * size. next/image resizes these types, but hands HEIC back as it is (most
 * browsers can't show it) and can't be counted on to read raw GPR or DNG.
 * One over 25 MB downloads on its own, so its link would save it, not open
 * it. Anything else gets a tile with its name and a download button.
 */
export function showsAsPhoto(f: { contentType: string; size: number }): boolean {
  return /^image\/(jpeg|png|webp|gif|avif)$/.test(f.contentType) && !downloadsOneAtATime(f);
}

export interface Gallery {
  bookingId: string;
  firstName: string;
  date: string;
  timeSlot: TourTimeSlot;
  tourName: string;
  files: GalleryFile[];
  /**
   * The link it was opened with, for the download links: `?k=` (the photos
   * email's, which anyone in the party may have) or `?t=` (the booker's own
   * booking page, which can link back to it).
   */
  opened: { k: string } | { t: string };
}

/** The gallery's credentials: the photos email's key, or the booker's own token. */
export interface GalleryCredential {
  key?: string | null;
  token?: string | null;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function storageBucketName(): string {
  return process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? '';
}

/**
 * The photos from this booking's departure, or null if the link is wrong
 * or the booking didn't go out (cancelled, no-show). Every party on a
 * shared tour sees the same photos. The photos email links it with a key
 * made from the booking's token (`?k=`, lib/gallery-link.ts), which the
 * booker can forward; their booking page with the token itself (`?t=`).
 * Both stop working when Travis resets the booking's links.
 */
export async function galleryForBooking(bookingId: string, cred: GalleryCredential): Promise<Gallery | null> {
  if (!/^[\w-]{1,64}$/.test(bookingId) || (!cred.key && !cred.token)) return null;
  const db = adminDb();
  const booking = (await db.collection('bookings').doc(bookingId).get()).data() as
    | (BookingRow & { accessToken?: string; customerName: string })
    | undefined;
  if (!booking?.accessToken || !onTheBoat(bookingId, booking.status, booking.closure)) return null;
  let opened: Gallery['opened'];
  if (cred.token && safeEqual(cred.token, booking.accessToken)) opened = { t: cred.token };
  else if (cred.key && safeEqual(cred.key, galleryKey(booking.accessToken))) opened = { k: cred.key };
  else return null;

  const id = tripId(booking.date, booking.timeSlot);
  const files = await db.collection('tripPhotos').doc(id).collection('files').orderBy('uploadedAt', 'asc').get();
  const bucket = storageBucketName();
  return {
    bookingId,
    firstName: booking.customerName.split(' ')[0] || booking.customerName,
    date: booking.date,
    timeSlot: booking.timeSlot,
    tourName: booking.tourName,
    opened,
    files: files.docs.map((d) => {
      const f = d.data() as {
        name: string;
        contentType: string;
        size: number;
        storagePath: string;
        downloadToken: string;
        attachment?: boolean;
      };
      return {
        id: d.id,
        name: f.name,
        contentType: f.contentType,
        size: f.size,
        url: storageFileUrl(bucket, f.storagePath, f.downloadToken, process.env.FIREBASE_STORAGE_EMULATOR_HOST),
        attachment: f.attachment === true,
      };
    }),
  };
}

/** One file of the booking's gallery, for the download route. */
export async function galleryFile(
  bookingId: string,
  cred: GalleryCredential,
  fileId: string,
): Promise<GalleryFile | null> {
  const gallery = await galleryForBooking(bookingId, cred);
  return gallery?.files.find((f) => f.id === fileId) ?? null;
}

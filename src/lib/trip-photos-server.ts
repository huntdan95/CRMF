import 'server-only';
import { randomBytes } from 'node:crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { adminDb } from './firebase/admin';
import { isValidIsoDate } from './date';
import { slotLabels, tours, type TourTimeSlot, type TourType } from './tours';
import { storageFileUrl } from './storage-url';

/*
 * Trip photos, website side. The crew upload from a no-login link,
 * /upload/<token>, straight to Firebase Storage (storage.rules checks the
 * token). A Cloud Function records each file and copies it to Travis's
 * Google Drive; guests see their departure's photos at
 * /my-booking/<id>/photos. Layout (keep in sync with
 * functions/src/lib/trip-photos.ts):
 *
 *   tripPhotos/{tripId}              uploadToken, photoCount, lastUploadAt, driveFolderUrl
 *   tripPhotos/{tripId}/files/{id}   storagePath, name, contentType, size, downloadToken
 *   tripUploadTokens/{token}         tripId, expiresAt
 *
 * A trip is one departure, `YYYY-MM-DD_<timeSlot>`: every booking on the
 * same boat at the same time.
 */

/** Uploads stop being accepted this many days after the trip. */
export const UPLOAD_WINDOW_DAYS = 7;

/** How far back the crew app lists trips to upload to. */
export const RECENT_TRIP_DAYS = 7;

/** Bookings whose guests actually went out (no-shows and cancellations don't get photos). */
const ON_THE_BOAT = new Set(['confirmed', 'completed']);

export function tripId(date: string, timeSlot: string): string {
  return `${date}_${timeSlot}`;
}

export function parseTripId(id: string): { date: string; timeSlot: TourTimeSlot } | null {
  const [date, timeSlot, extra] = id.split('_');
  if (extra !== undefined || !date || !timeSlot) return null;
  if (!isValidIsoDate(date) || !(timeSlot in slotLabels)) return null;
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

/** "10:30 AM", from the tour schedule. */
export function departureTimeOf(timeSlot: TourTimeSlot, tourId?: string): string {
  const tour = tours.find((t) => t.id === tourId) ?? tours.find((t) => t.timeSlot === timeSlot);
  return tour?.startTimeDisplay ?? slotLabels[timeSlot];
}

function startMinutes(tourId: string, timeSlot: TourTimeSlot): number {
  const tour = tours.find((t) => t.id === tourId) ?? tours.find((t) => t.timeSlot === timeSlot);
  const [h, m] = (tour?.startTime ?? '00:00').split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
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
  guests: number;
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
}

/** The bookings on a trip's boat; empty if the trip doesn't exist. */
async function tripBookings(date: string, timeSlot: TourTimeSlot): Promise<BookingRow[]> {
  const snap = await adminDb().collection('bookings').where('date', '==', date).get();
  return snap.docs
    .map((d) => ({ ...(d.data() as Omit<BookingRow, 'id'>), id: d.id }))
    .filter((b) => b.timeSlot === timeSlot && ON_THE_BOAT.has(b.status));
}

/**
 * Departures from the last {@link RECENT_TRIP_DAYS} days that have left
 * the dock (today's only once their start time has passed), newest first,
 * each with its upload link token and photo count.
 */
export async function fetchRecentTrips(now: { date: string; minutes: number }): Promise<RecentTrip[]> {
  const db = adminDb();
  const from = addDays(now.date, -RECENT_TRIP_DAYS);
  const snap = await db
    .collection('bookings')
    .where('date', '>=', from)
    .where('date', '<=', now.date)
    .select('date', 'timeSlot', 'tourId', 'type', 'guestCount', 'status')
    .get();

  const trips = new Map<string, Omit<RecentTrip, 'photoCount' | 'uploadToken'>>();
  for (const doc of snap.docs) {
    const b = doc.data() as Omit<BookingRow, 'id'>;
    if (!ON_THE_BOAT.has(b.status)) continue;
    if (b.date === now.date && startMinutes(b.tourId, b.timeSlot) > now.minutes) continue;
    const id = tripId(b.date, b.timeSlot);
    const trip = trips.get(id);
    if (trip) trip.guests += b.guestCount;
    else trips.set(id, { id, date: b.date, timeSlot: b.timeSlot, tourId: b.tourId, type: b.type, guests: b.guestCount });
  }

  const out: RecentTrip[] = [];
  for (const trip of trips.values()) {
    const uploadToken = await ensureUploadToken(trip.date, trip.timeSlot);
    const photoCount = ((await db.collection('tripPhotos').doc(trip.id).get()).get('photoCount') as number) ?? 0;
    out.push({ ...trip, uploadToken, photoCount });
  }
  return out.sort(
    (a, b) =>
      b.date.localeCompare(a.date) ||
      startMinutes(b.tourId, b.timeSlot) - startMinutes(a.tourId, a.timeSlot),
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
}

export interface Gallery {
  bookingId: string;
  firstName: string;
  date: string;
  timeSlot: TourTimeSlot;
  tourName: string;
  files: GalleryFile[];
}

export function storageBucketName(): string {
  return process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? '';
}

/**
 * The photos from this booking's departure, or null if the link is wrong
 * or the booking didn't go out (cancelled, no-show). Every party on a
 * shared tour sees the same photos.
 */
export async function galleryForBooking(bookingId: string, accessToken: string): Promise<Gallery | null> {
  if (!/^[\w-]{1,64}$/.test(bookingId) || !accessToken) return null;
  const db = adminDb();
  const booking = (await db.collection('bookings').doc(bookingId).get()).data() as
    | (BookingRow & { accessToken?: string; customerName: string })
    | undefined;
  if (!booking || booking.accessToken !== accessToken || !ON_THE_BOAT.has(booking.status)) return null;

  const id = tripId(booking.date, booking.timeSlot);
  const files = await db.collection('tripPhotos').doc(id).collection('files').orderBy('uploadedAt', 'asc').get();
  const bucket = storageBucketName();
  return {
    bookingId,
    firstName: booking.customerName.split(' ')[0] || booking.customerName,
    date: booking.date,
    timeSlot: booking.timeSlot,
    tourName: booking.tourName,
    files: files.docs.map((d) => {
      const f = d.data() as { name: string; contentType: string; size: number; storagePath: string; downloadToken: string };
      return {
        id: d.id,
        name: f.name,
        contentType: f.contentType,
        size: f.size,
        url: storageFileUrl(bucket, f.storagePath, f.downloadToken, process.env.FIREBASE_STORAGE_EMULATOR_HOST),
      };
    }),
  };
}

/** One file of the booking's gallery, for the download routes. */
export async function galleryFile(
  bookingId: string,
  accessToken: string,
  fileId: string,
): Promise<{ name: string; contentType: string; size: number; storagePath: string } | null> {
  const gallery = await galleryForBooking(bookingId, accessToken);
  if (!gallery || !/^[\w-]{1,64}$/.test(fileId)) return null;
  const doc = await adminDb()
    .collection('tripPhotos')
    .doc(tripId(gallery.date, gallery.timeSlot))
    .collection('files')
    .doc(fileId)
    .get();
  if (!doc.exists) return null;
  return doc.data() as { name: string; contentType: string; size: number; storagePath: string };
}

/** Every file of the booking's gallery with its storage path, for download-all. */
export async function galleryStoragePaths(
  bookingId: string,
  accessToken: string,
): Promise<{ gallery: Gallery; files: Array<{ name: string; storagePath: string }> } | null> {
  const gallery = await galleryForBooking(bookingId, accessToken);
  if (!gallery) return null;
  const snap = await adminDb()
    .collection('tripPhotos')
    .doc(tripId(gallery.date, gallery.timeSlot))
    .collection('files')
    .orderBy('uploadedAt', 'asc')
    .get();
  return {
    gallery,
    files: snap.docs.map((d) => ({ name: d.get('name') as string, storagePath: d.get('storagePath') as string })),
  };
}

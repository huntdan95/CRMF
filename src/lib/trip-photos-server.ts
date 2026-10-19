import 'server-only';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from './firebase/admin';
import { isValidIsoDate } from './date';
import { formatClock, slotLabels, type TourTimeSlot, type TourType } from './tours';
import { SLOT_MINUTES, slotStartMinutes, slotStartTime } from './schedule';
import {
  createFolder,
  deleteFile,
  getLiveFile,
  writeTextFile,
} from './google-drive';

/*
 * Trip photos: crew upload the GoPro shots from each trip in the crew app,
 * and they land in Google Drive for grokbot to email to that trip's guests.
 *
 * Drive layout (in the account connected with `npm run connect:drive`):
 *
 *   Manatee Fun Trip Photos/
 *     2026-10-17 08:00 Morning shared/
 *       guests.csv            who was on the boat (name, email, party)
 *       _READY_TO_SEND.txt    added when the crew tap "Photos are all in"
 *       GOPR0123.JPG …
 *
 * Grokbot's contract: only email a folder's guests once it contains
 * _READY_TO_SEND.txt, and only once.
 *
 * Firestore keeps the bookkeeping (server-only):
 *   tripPhotos/{tripId}           folder ids, photo count, ready flag
 *   driveConfig/tripPhotos        the root folder's id
 *
 * A trip is one departure, `YYYY-MM-DD_<timeSlot>`: every booking on the
 * same boat at the same time.
 */

export const ROOT_FOLDER_NAME = 'Manatee Fun Trip Photos';
export const GUESTS_FILE_NAME = 'guests.csv';
export const READY_FILE_NAME = '_READY_TO_SEND.txt';

/** How far back the crew app offers trips for upload. */
export const RECENT_TRIP_DAYS = 7;

/**
 * Bookings whose guests actually went out (no-shows and cancellations don't
 * get photos). Old-site bookings held with a deposit were imported as
 * `pending-payment`; a new-site one is an abandoned checkout.
 */
function onTheBoat(id: string, status: string): boolean {
  return (
    status === 'confirmed' ||
    status === 'completed' ||
    (status === 'pending-payment' && id.startsWith('legacy-'))
  );
}

export interface TripPhotoStatus {
  photoCount: number;
  readyAt: number | null;
  readyBy: string | null;
}

export interface RecentTrip {
  id: string;
  date: string;
  timeSlot: TourTimeSlot;
  tourId: string;
  type: TourType;
  guests: number;
  photos: TripPhotoStatus;
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
  customerName: string;
  customerEmail: string;
  guests?: { name: string; age: number | null }[];
}

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
  const dt = new Date(Date.UTC(y!, m! - 1, d! + days));
  return dt.toISOString().slice(0, 10);
}

/** From the schedule: the sunset cruise leaves at a different time each day. */
function startMinutes(timeSlot: TourTimeSlot, date: string): number {
  return timeSlot in SLOT_MINUTES ? slotStartMinutes(timeSlot, date) : 0;
}

/**
 * Departures from the last {@link RECENT_TRIP_DAYS} days that have left
 * the dock (today's only once their start time has passed), newest first,
 * with where their photos stand.
 */
export async function fetchRecentTrips(now: {
  date: string;
  minutes: number;
}): Promise<RecentTrip[]> {
  const db = adminDb();
  const from = addDays(now.date, -RECENT_TRIP_DAYS);
  const snap = await db
    .collection('bookings')
    .where('date', '>=', from)
    .where('date', '<=', now.date)
    .select('date', 'timeSlot', 'tourId', 'type', 'guestCount', 'status')
    .get();

  const trips = new Map<string, RecentTrip>();
  for (const doc of snap.docs) {
    const b = doc.data() as Omit<BookingRow, 'id'>;
    if (!onTheBoat(doc.id, b.status)) continue;
    if (b.date === now.date && startMinutes(b.timeSlot, b.date) > now.minutes) continue;
    const id = tripId(b.date, b.timeSlot);
    const trip = trips.get(id);
    if (trip) {
      trip.guests += b.guestCount;
    } else {
      trips.set(id, {
        id,
        date: b.date,
        timeSlot: b.timeSlot,
        tourId: b.tourId,
        type: b.type,
        guests: b.guestCount,
        photos: { photoCount: 0, readyAt: null, readyBy: null },
      });
    }
  }
  if (trips.size === 0) return [];

  const statuses = await db.getAll(
    ...[...trips.keys()].map((id) => db.collection('tripPhotos').doc(id)),
  );
  for (const s of statuses) {
    const trip = trips.get(s.id);
    if (!trip || !s.exists) continue;
    trip.photos = {
      photoCount: (s.get('photoCount') as number | undefined) ?? 0,
      readyAt: s.get('readyAt')?.toMillis?.() ?? null,
      readyBy: (s.get('readyBy') as string | undefined) ?? null,
    };
  }

  return [...trips.values()].sort(
    (a, b) =>
      b.date.localeCompare(a.date) ||
      startMinutes(b.timeSlot, b.date) - startMinutes(a.timeSlot, a.date),
  );
}

/** The bookings on a trip's boat; empty if the trip doesn't exist. */
async function tripBookings(date: string, timeSlot: TourTimeSlot): Promise<BookingRow[]> {
  const snap = await adminDb().collection('bookings').where('date', '==', date).get();
  return snap.docs
    .map((d) => ({ ...(d.data() as Omit<BookingRow, 'id'>), id: d.id }))
    .filter((b) => b.timeSlot === timeSlot && onTheBoat(b.id, b.status));
}

/**
 * Whether crew can upload to this trip right now: it has guests and is
 * within the recent window. Mirrors {@link fetchRecentTrips}.
 */
export async function isUploadableTrip(
  id: string,
  now: { date: string; minutes: number },
): Promise<boolean> {
  const parsed = parseTripId(id);
  if (!parsed) return false;
  if (parsed.date > now.date || parsed.date < addDays(now.date, -RECENT_TRIP_DAYS)) return false;
  const bookings = await tripBookings(parsed.date, parsed.timeSlot);
  if (bookings.length === 0) return false;
  if (parsed.date === now.date) {
    return startMinutes(parsed.timeSlot, parsed.date) <= now.minutes;
  }
  return true;
}

function csvCell(value: string | number): string {
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Names come from checkout as typed; one starting with = + - @ would run as
 * a formula if Travis opens guests.csv in Sheets or Excel.
 */
function noFormula(name: string): string {
  return /^[=+\-@\t\r]/.test(name) ? `'${name}` : name;
}

function folderName(date: string, bookings: BookingRow[], timeSlot: TourTimeSlot): string {
  const first = bookings[0];
  const type = first?.type === 'private' ? 'private' : 'shared';
  return `${date} ${slotStartTime(timeSlot, date)} ${slotLabels[timeSlot]} ${type}`.replace(/\s+/g, ' ');
}

/** guests.csv: one row per booking on the boat, for grokbot to email. */
function guestsCsv(date: string, timeSlot: TourTimeSlot, bookings: BookingRow[]): string {
  const header = [
    'trip_date',
    'departure',
    'tour',
    'booking_id',
    'customer_name',
    'customer_email',
    'party_size',
    'party_names',
  ];
  const rows = bookings.map((b) => {
    return [
      date,
      formatClock(startMinutes(timeSlot, date)),
      b.tourName,
      b.id,
      noFormula(b.customerName),
      b.customerEmail,
      b.guestCount,
      noFormula((b.guests ?? []).map((g) => g.name).join('; ')),
    ];
  });
  return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

/**
 * The shared "Manatee Fun Trip Photos" folder, created on first use, with
 * the same create-then-claim race handling as {@link ensureTripFolder}.
 */
async function ensureRootFolder(): Promise<string> {
  const ref = adminDb().collection('driveConfig').doc('tripPhotos');
  const snap = await ref.get();
  const existing = snap.get('rootFolderId') as string | undefined;
  if (existing && (await getLiveFile(existing))) return existing;

  const folder = await createFolder(ROOT_FOLDER_NAME);
  const won = await adminDb().runTransaction(async (tx) => {
    const current = (await tx.get(ref)).get('rootFolderId') as string | undefined;
    if (current && current !== existing) return false;
    tx.set(ref, { rootFolderId: folder.id, createdAt: FieldValue.serverTimestamp() });
    return true;
  });
  if (!won) {
    await deleteFile(folder.id).catch(() => undefined);
    return (await ref.get()).get('rootFolderId') as string;
  }
  return folder.id;
}

/**
 * The trip's Drive folder (with guests.csv in it), created on the first
 * upload. Two crew uploading at once both create a folder; the
 * transaction picks one and the other is deleted.
 */
export async function ensureTripFolder(id: string): Promise<string> {
  const parsed = parseTripId(id);
  if (!parsed) throw new Error(`Bad trip id: ${id}`);
  const ref = adminDb().collection('tripPhotos').doc(id);

  const snap = await ref.get();
  const existing = snap.get('folderId') as string | undefined;
  if (existing && (await getLiveFile(existing))) return existing;

  const bookings = await tripBookings(parsed.date, parsed.timeSlot);
  const folder = await createFolder(
    folderName(parsed.date, bookings, parsed.timeSlot),
    await ensureRootFolder(),
  );

  const won = await adminDb().runTransaction(async (tx) => {
    const current = await tx.get(ref);
    if (current.get('folderId') && current.get('folderId') !== existing) return false;
    tx.set(
      ref,
      {
        date: parsed.date,
        timeSlot: parsed.timeSlot,
        folderId: folder.id,
        folderUrl: folder.webViewLink ?? null,
        guestsFileId: null,
        readyFileId: null,
        // A new folder starts empty, even if an old one was trashed in Drive.
        photoCount: 0,
        readyAt: null,
        readyBy: null,
        createdAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return true;
  });
  if (!won) {
    await deleteFile(folder.id).catch(() => undefined);
    return (await ref.get()).get('folderId') as string;
  }

  const guests = await writeTextFile({
    name: GUESTS_FILE_NAME,
    parentId: folder.id,
    mimeType: 'text/csv',
    content: guestsCsv(parsed.date, parsed.timeSlot, bookings),
  });
  await ref.update({ guestsFileId: guests.id });
  return folder.id;
}

export async function recordUploads(id: string, count: number, crewName: string): Promise<void> {
  await adminDb()
    .collection('tripPhotos')
    .doc(id)
    .set(
      {
        photoCount: FieldValue.increment(count),
        uploaders: FieldValue.arrayUnion(crewName),
        lastUploadAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
}

/**
 * "Photos are all in": refreshes guests.csv (in case a booking changed
 * since the folder was made) and drops _READY_TO_SEND.txt in the folder.
 */
export async function markTripReady(id: string, crewName: string): Promise<void> {
  const parsed = parseTripId(id);
  if (!parsed) throw new Error(`Bad trip id: ${id}`);
  const folderId = await ensureTripFolder(id);
  const ref = adminDb().collection('tripPhotos').doc(id);
  const snap = await ref.get();
  const bookings = await tripBookings(parsed.date, parsed.timeSlot);

  const guests = await writeTextFile({
    name: GUESTS_FILE_NAME,
    parentId: folderId,
    mimeType: 'text/csv',
    content: guestsCsv(parsed.date, parsed.timeSlot, bookings),
    existingId: snap.get('guestsFileId') as string | null,
  });
  const readyAt = new Date();
  const ready = await writeTextFile({
    name: READY_FILE_NAME,
    parentId: folderId,
    mimeType: 'text/plain',
    content: [
      `Photos for this trip are all uploaded and ready to send to the guests in ${GUESTS_FILE_NAME}.`,
      '',
      `Marked ready by ${crewName} on ${readyAt.toLocaleString('en-US', { timeZone: 'America/New_York' })} (Crystal River time).`,
      `Photos uploaded through the crew app: ${(snap.get('photoCount') as number | undefined) ?? 0}`,
      '',
    ].join('\n'),
    existingId: snap.get('readyFileId') as string | null,
  });

  await ref.update({
    guestsFileId: guests.id,
    readyFileId: ready.id,
    readyAt: FieldValue.serverTimestamp(),
    readyBy: crewName,
  });
}

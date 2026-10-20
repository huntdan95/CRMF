import { createHash, randomUUID } from 'node:crypto';
import { onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onObjectFinalized } from 'firebase-functions/v2/storage';
import { logger } from 'firebase-functions/v2';
import { getStorage } from 'firebase-admin/storage';
import { z } from 'zod';

import { db, FieldValue, Timestamp } from './lib/firebase';
import { RESEND_API_KEY, RESEND_FROM_EMAIL } from './lib/resend';
import { APP_BASE_URL } from './lib/config';
import { addDays, marinaNow, zonedTimeToUtc } from './lib/datetime';
import { slotLabels } from './lib/tours';
import { departureTime } from './lib/trip-format';
import { getsAutomatedEmail } from './lib/notify';
import { forEachBooking, sendGuestOnce } from './lib/guest-send';
import { buildTripPhotosEmail, galleryUrl } from './lib/guest-templates';
import { copyToDrive, deleteDriveFile, driveConnection } from './lib/google-drive';
import {
  UPLOAD_WINDOW_DAYS,
  ensureUploadToken,
  parseTripId,
  uploadUrl,
} from './lib/trip-photos';
import { applyCors, badRequest, methodNotAllowed, serverError } from './lib/http';
import { requireAdmin, writeAudit, AdminAuthError } from './lib/admin-auth';
import type { Booking, TourTimeSlot } from './lib/types';

/*
 * Guest photos, start to finish, with nobody having to do anything after
 * the crew upload from their phones:
 *
 *   onTripPhotoUploaded   a file lands in trips/<tripId>/: record it for the
 *                         gallery, then copy it to Travis's Google Drive
 *   sendTripPhotos        every 15 min: email each party on a departure
 *                         that has photos (9:00 AM the day after; later
 *                         uploads once they've stopped for an hour)
 *   retryDriveCopies      hourly: Drive copies that failed or waited for
 *                         Travis to connect Drive
 *   adminDeleteTripPhoto  Admin → Trip photos: take one down
 *   adminTripUploadLink   the upload link for a departure, made if needed
 *
 * See lib/trip-photos.ts for the data layout.
 */

const FILES = 'files';

export interface TripFileDoc {
  storagePath: string;
  name: string;
  contentType: string;
  size: number;
  downloadToken: string;
  uploadedAt: FirebaseFirestore.FieldValue | FirebaseFirestore.Timestamp;
  drive: {
    status: 'pending' | 'copied' | 'failed' | 'not-connected';
    fileId?: string | null;
    error?: string | null;
    attempts?: number;
  };
}

/** Stable id for a stored file, from its path. */
function fileIdFor(path: string): string {
  return createHash('sha256').update(path).digest('hex').slice(0, 24);
}

/** "2026-10-17 10:30 AM Mid-morning": the trip's folder in Drive. */
function driveFolderName(tripId: string): string {
  const parsed = parseTripId(tripId);
  if (!parsed) return tripId;
  return `${parsed.date} ${departureTime(parsed.timeSlot, parsed.date)} ${slotLabels[parsed.timeSlot] ?? parsed.timeSlot}`;
}

/** Original name, without the random prefix the uploader adds. */
function displayName(objectName: string): string {
  const base = objectName.split('/').pop() ?? objectName;
  return base.replace(/^[0-9a-f-]{8,}-/i, '');
}

/* -------------------------------------------------------------------------- */
/* Upload trigger                                                             */
/* -------------------------------------------------------------------------- */

// A Storage trigger has to run in its bucket's region. The project's bucket
// is in us-east1; the other functions stay in us-central1.
export const onTripPhotoUploaded = onObjectFinalized(
  { region: 'us-east1', memory: '1GiB', timeoutSeconds: 540, retry: false },
  async (event) => {
    const obj = event.data;
    if (!obj.name?.startsWith('trips/')) return;
    await recordTripUpload(obj.bucket, obj.name);
  },
);

/** Records a new file for the gallery, then copies it to Drive. Safe to run twice. */
export async function recordTripUpload(bucketName: string, path: string): Promise<string> {
  const [, tripId] = path.split('/');
  if (!tripId || !parseTripId(tripId)) {
    logger.warn('Trip upload outside a trip folder', { path });
    return 'bad-path';
  }
  const file = getStorage().bucket(bucketName).file(path);
  const [meta] = await file.getMetadata();
  const custom = (meta.metadata ?? {}) as Record<string, string | null>;

  // A download token lets the website show the photo without making the
  // bucket public. The upload token isn't needed on the file any more.
  const downloadToken = custom.firebaseStorageDownloadTokens?.split(',')[0] || randomUUID();
  if (!custom.firebaseStorageDownloadTokens || custom.uploadToken) {
    await file.setMetadata({ metadata: { firebaseStorageDownloadTokens: downloadToken, uploadToken: null } });
  }

  const tripRef = db.collection('tripPhotos').doc(tripId);
  const fileRef = tripRef.collection(FILES).doc(fileIdFor(path));
  const created = await db.runTransaction(async (tx) => {
    if ((await tx.get(fileRef)).exists) return false;
    const doc: TripFileDoc = {
      storagePath: path,
      name: displayName(path),
      contentType: meta.contentType ?? 'application/octet-stream',
      size: Number(meta.size ?? 0),
      downloadToken,
      uploadedAt: FieldValue.serverTimestamp(),
      drive: { status: 'pending', attempts: 0 },
    };
    tx.set(fileRef, doc);
    tx.set(
      tripRef,
      {
        photoCount: FieldValue.increment(1),
        lastUploadAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return true;
  });
  if (!created) return 'already-recorded';

  await copyFileToDrive(tripId, fileRef.id, bucketName);
  return 'recorded';
}

/** Copies one recorded file to Drive and records how it went. Never throws. */
async function copyFileToDrive(tripId: string, fileId: string, bucketName?: string): Promise<string> {
  const fileRef = db.collection('tripPhotos').doc(tripId).collection(FILES).doc(fileId);
  const doc = (await fileRef.get()).data() as TripFileDoc | undefined;
  if (!doc || doc.drive?.status === 'copied') return 'skip';
  try {
    const bucket = bucketName ? getStorage().bucket(bucketName) : getStorage().bucket();
    const driveFileId = await copyToDrive({
      tripId,
      folderName: driveFolderName(tripId),
      name: doc.name,
      mimeType: doc.contentType,
      size: doc.size,
      open: () => bucket.file(doc.storagePath).createReadStream(),
    });
    if (!driveFileId) {
      await fileRef.update({ 'drive.status': 'not-connected' });
      logger.info('Google Drive not connected; trip photo kept for the gallery only', { tripId, fileId });
      return 'not-connected';
    }
    await fileRef.update({
      'drive.status': 'copied',
      'drive.fileId': driveFileId,
      'drive.error': null,
      'drive.copiedAt': FieldValue.serverTimestamp(),
    });
    return 'copied';
  } catch (err) {
    logger.error('Copying trip photo to Drive failed', { tripId, fileId, err });
    await fileRef
      .update({
        'drive.status': 'failed',
        'drive.error': err instanceof Error ? err.message.slice(0, 300) : 'unknown',
        'drive.attempts': FieldValue.increment(1),
        'drive.lastAttemptAt': FieldValue.serverTimestamp(),
      })
      .catch(() => undefined);
    return 'failed';
  }
}

/* -------------------------------------------------------------------------- */
/* Photo emails                                                               */
/* -------------------------------------------------------------------------- */

/** Guests hear about photos only between these marina hours... */
const SEND_HOURS = { from: 8 * 60, to: 20 * 60 };
/** ...not before 9:00 AM the day after the trip... */
const FIRST_SEND = '09:00';
/** ...and only once uploads have stopped for an hour. */
const QUIET_MS = 60 * 60 * 1000;

export const sendTripPhotos = onSchedule(
  {
    schedule: 'every 15 minutes',
    timeZone: 'America/New_York',
    region: 'us-central1',
    secrets: [RESEND_API_KEY, RESEND_FROM_EMAIL, APP_BASE_URL],
    retryCount: 0,
  },
  async () => {
    await runTripPhotos(new Date());
  },
);

/**
 * Emails every party on a departure with photos (marker `photosSentAt`):
 * from 9:00 AM ET the day after the trip, once nobody has uploaded for 60
 * minutes, only 8 AM–8 PM ET, and up to 7 days after the trip. Photos that
 * arrive after a party was emailed just show up in the same gallery.
 */
export async function runTripPhotos(now: Date) {
  const clock = marinaNow(now);
  const empty = { sent: 0, failed: 0, skipped: 0 };
  if (clock.minutes < SEND_HOURS.from || clock.minutes >= SEND_HOURS.to) return empty;

  const trips = await db
    .collection('tripPhotos')
    .where('date', '>=', addDays(clock.date, -UPLOAD_WINDOW_DAYS))
    .where('date', '<', clock.date)
    .get();

  const ready = trips.docs.filter((t) => {
    const date = t.get('date') as string;
    const last = t.get('lastUploadAt') as Timestamp | undefined;
    return (
      (t.get('photoCount') ?? 0) > 0 &&
      now.getTime() >= zonedTimeToUtc(addDays(date, 1), FIRST_SEND).getTime() &&
      !!last &&
      now.getTime() - last.toMillis() >= QUIET_MS
    );
  });

  const baseUrl = APP_BASE_URL.value();
  const totals = { ...empty };
  for (const trip of ready) {
    const { date, timeSlot } = trip.data() as { date: string; timeSlot: TourTimeSlot };
    const snap = await db.collection('bookings').where('date', '==', date).get();
    const parties = snap.docs
      .map((d) => ({ ...(d.data() as Booking & { photosSentAt?: unknown }), id: d.id }))
      .filter((b) => b.timeSlot === timeSlot && !b.photosSentAt && getsAutomatedEmail(b) && !!b.accessToken);
    const count = (trip.get('photoCount') as number) ?? 0;
    const result = await forEachBooking(`Trip photos ${trip.id}`, parties, (b) =>
      sendGuestOnce(b, 'photosSentAt', {
        type: 'trip-photos',
        key: `trip-photos/${b.id}/${trip.id}`,
        ...buildTripPhotosEmail({ booking: b, galleryUrl: galleryUrl(baseUrl, b)!, count }),
      }),
    );
    totals.sent += result.sent;
    totals.failed += result.failed;
    totals.skipped += result.skipped;
  }
  return totals;
}

/* -------------------------------------------------------------------------- */
/* Drive retries                                                              */
/* -------------------------------------------------------------------------- */

/** A copy that keeps failing stops being retried after this many tries. */
const MAX_DRIVE_ATTEMPTS = 5;

export const retryDriveCopies = onSchedule(
  {
    schedule: 'every 60 minutes',
    timeZone: 'America/New_York',
    region: 'us-central1',
    memory: '1GiB',
    timeoutSeconds: 540,
    retryCount: 0,
  },
  async () => {
    await runDriveRetry(new Date());
  },
);

/**
 * Copies to Drive anything from the last week that hasn't made it there:
 * failed copies, and uploads from before Travis connected Drive.
 */
export async function runDriveRetry(now: Date): Promise<number> {
  if (!(await driveConnection())) return 0;
  const since = addDays(marinaNow(now).date, -(UPLOAD_WINDOW_DAYS + 1));
  const trips = await db.collection('tripPhotos').where('date', '>=', since).get();
  let copied = 0;
  for (const trip of trips.docs) {
    const files = await trip.ref.collection(FILES).get();
    for (const f of files.docs) {
      const drive = (f.data() as TripFileDoc).drive ?? { status: 'pending' };
      if (drive.status === 'copied' || (drive.attempts ?? 0) >= MAX_DRIVE_ATTEMPTS) continue;
      if ((await copyFileToDrive(trip.id, f.id)) === 'copied') copied++;
    }
  }
  if (copied) logger.info('Drive retry copied trip photos', { copied });
  return copied;
}

/* -------------------------------------------------------------------------- */
/* Admin                                                                      */
/* -------------------------------------------------------------------------- */

function handleAuthError(res: import('express').Response, err: unknown): boolean {
  if (err instanceof AdminAuthError) {
    res.status(err.status).json({ error: err.message });
    return true;
  }
  return false;
}

/**
 * POST /adminDeleteTripPhoto { tripId, fileId }
 *
 * Takes a photo out of the guest gallery and deletes the file, and its
 * Drive copy if there is one.
 */
export const adminDeleteTripPhoto = onRequest({ cors: false, maxInstances: 5 }, async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  try {
    const admin = await requireAdmin(req);
    const parsed = z
      .object({ tripId: z.string().min(1).max(64), fileId: z.string().min(1).max(64) })
      .safeParse(req.body);
    if (!parsed.success) return badRequest(res, 'Invalid input', parsed.error.format());
    const { tripId, fileId } = parsed.data;

    const tripRef = db.collection('tripPhotos').doc(tripId);
    const fileRef = tripRef.collection(FILES).doc(fileId);
    const doc = (await fileRef.get()).data() as TripFileDoc | undefined;
    if (!doc) {
      res.status(404).json({ error: 'That photo is already gone.' });
      return;
    }

    await getStorage()
      .bucket()
      .file(doc.storagePath)
      .delete()
      .catch((err: { code?: number }) => {
        if (err.code !== 404) throw err;
      });
    await db.runTransaction(async (tx) => {
      if (!(await tx.get(fileRef)).exists) return;
      tx.delete(fileRef);
      tx.set(tripRef, { photoCount: FieldValue.increment(-1) }, { merge: true });
    });
    let driveDeleted = false;
    if (doc.drive?.fileId) {
      try {
        await deleteDriveFile(doc.drive.fileId);
        driveDeleted = true;
      } catch (err) {
        logger.error('Deleting the Drive copy failed', { tripId, fileId, err });
      }
    }

    await writeAudit({
      admin,
      action: 'tripPhoto.delete',
      targetId: tripId,
      payload: { fileId, name: doc.name, storagePath: doc.storagePath, driveDeleted },
    });
    res.status(200).json({ ok: true, driveDeleted });
  } catch (err) {
    if (handleAuthError(res, err)) return;
    serverError(res, err);
  }
});

/**
 * POST /adminTripUploadLink { date, timeSlot }
 *
 * The crew's upload link for a departure, for the admin booking page.
 * Made on first use; the 8 PM crew email makes tomorrow's too.
 */
export const adminTripUploadLink = onRequest(
  { cors: false, secrets: [APP_BASE_URL], maxInstances: 5 },
  async (req, res) => {
    if (applyCors(req, res)) return;
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    try {
      await requireAdmin(req);
      const parsed = z
        .object({
          date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          timeSlot: z.enum(['morning', 'mid-morning', 'early-afternoon', 'late-afternoon', 'whole-day']),
        })
        .safeParse(req.body);
      if (!parsed.success) return badRequest(res, 'Invalid input', parsed.error.format());
      const { tripId, token } = await ensureUploadToken(parsed.data.date, parsed.data.timeSlot);
      res.status(200).json({ ok: true, tripId, uploadUrl: uploadUrl(APP_BASE_URL.value(), token) });
    } catch (err) {
      if (handleAuthError(res, err)) return;
      serverError(res, err);
    }
  },
);

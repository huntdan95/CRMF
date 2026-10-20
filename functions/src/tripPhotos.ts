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
import { getsAutomatedEmail, onOpenDepartures } from './lib/notify';
import { forEachBooking, sendGuestOnce } from './lib/guest-send';
import { buildTripPhotosEmail, galleryUrl } from './lib/guest-templates';
import { DriveAuthError, DriveRefusedError, copyToDrive, deleteDriveFile, driveConnection } from './lib/google-drive';
import {
  UPLOAD_WINDOW_DAYS,
  attachmentDisposition,
  downloadsOneAtATime,
  ensureUploadToken,
  parseTripId,
  storedCopiesOf,
  uploadUrl,
  type StoredPhotos,
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
 *   retryDriveCopies      hourly: Drive copies that failed, or waited for
 *                         Travis to connect (or reconnect) Drive, or for
 *                         room in it
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
  /**
   * Storage hands it out as a download, under `name` (a video, or a big
   * file): the gallery links its download URL straight. Not set on files
   * recorded before this was.
   */
  attachment?: boolean;
  uploadedAt: FirebaseFirestore.FieldValue | FirebaseFirestore.Timestamp;
  drive: {
    status: 'pending' | 'copied' | 'failed' | 'not-connected';
    fileId?: string | null;
    error?: string | null;
    attempts?: number;
    /** Set while a copy is running: no other copy starts until it's past. */
    leaseUntil?: FirebaseFirestore.Timestamp | null;
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

/**
 * Original name, without the random UUID prefix the uploader adds (only
 * that: "face-bad.jpg" keeps its "face-"). It's what guests see and what
 * the file is saved as (in "Download all" too), so no path separators,
 * control characters or leading dots, whatever the uploader sent.
 */
export function displayName(objectName: string): string {
  const base = objectName.split('/').pop() ?? objectName;
  const name = base
    .replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i, '')
    .replace(/[\\/:\p{Cc}]/gu, '_')
    .replace(/^[.\s]+/, '');
  return name || 'photo';
}

/* -------------------------------------------------------------------------- */
/* Upload trigger                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Retried when it fails: nothing else ever records an upload, so a passing
 * error (Storage, or a busy trip doc while the crew upload a hundred
 * photos) would leave the photo out of the gallery for good. Running it
 * again is safe (recordTripUpload).
 */
export const onTripPhotoUploaded = onObjectFinalized(
  { region: 'us-central1', memory: '1GiB', timeoutSeconds: 540, retry: true },
  async (event) => {
    const obj = event.data;
    if (!obj.name?.startsWith('trips/')) return;
    await recordTripUpload(obj.bucket, obj.name);
  },
);

/**
 * Records a new file for the gallery, then copies it to Drive. Safe to run
 * twice: a file already recorded isn't recorded or copied again (the
 * hourly retry copies one whose copy never finished), and one deleted
 * since isn't recorded at all.
 */
export async function recordTripUpload(bucketName: string, path: string): Promise<string> {
  const [, tripId] = path.split('/');
  if (!tripId || !parseTripId(tripId)) {
    logger.warn('Trip upload outside a trip folder', { path });
    return 'bad-path';
  }
  const file = getStorage().bucket(bucketName).file(path);
  const [meta] = await file.getMetadata().catch((err: { code?: unknown } | null) => {
    // Gone before a retry got to it (Travis deleted it).
    if (err?.code === 404) return [null] as const;
    throw err;
  });
  if (!meta) return 'gone';
  const custom = (meta.metadata ?? {}) as Record<string, string | null>;
  const name = displayName(path);
  const contentType = meta.contentType ?? 'application/octet-stream';
  const size = Number(meta.size ?? 0);

  // A download token lets the website show the photo without making the
  // bucket public. The upload token isn't needed on the file any more.
  const downloadToken = custom.firebaseStorageDownloadTokens?.split(',')[0] || randomUUID();
  // A video or a big file downloads straight from Storage, so Storage saves
  // it under the name guests see. A <video> still plays it: the header only
  // matters when a link opens the file. Photos stay inline, so a photo
  // still opens full size in the gallery.
  const disposition = downloadsOneAtATime({ contentType, size }) ? attachmentDisposition(name) : null;
  if (!custom.firebaseStorageDownloadTokens || custom.uploadToken || (disposition && meta.contentDisposition !== disposition)) {
    await file.setMetadata({
      ...(disposition && { contentDisposition: disposition }),
      metadata: { firebaseStorageDownloadTokens: downloadToken, uploadToken: null },
    });
  }

  const tripRef = db.collection('tripPhotos').doc(tripId);
  const fileRef = tripRef.collection(FILES).doc(fileIdFor(path));
  const created = await db.runTransaction(async (tx) => {
    if ((await tx.get(fileRef)).exists) return false;
    const doc: TripFileDoc = {
      storagePath: path,
      name,
      contentType,
      size,
      downloadToken,
      ...(disposition && { attachment: true }),
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

  await copyFileToDrive(fileRef, tripId, bucketName);
  return 'recorded';
}

/** A copy that keeps failing stops being retried after this many tries. */
const MAX_DRIVE_ATTEMPTS = 5;

/**
 * How long a copy holds its file. Longer than the functions' 9-minute
 * timeout, so a copy still running never loses its file to another; one
 * whose function was stopped part way is picked up again once it's past.
 */
const LEASE_MS = 15 * 60 * 1000;

/**
 * Takes the file for one copy, so the upload trigger and the hourly retry
 * never copy it at the same time (two copies in Drive, and deleting the
 * photo would only remove one). Null if it's copied, given up on, gone, or
 * another copy holds it. A lease that ran out means that copy's function
 * was stopped part way (a huge video, say): that counts as one of its tries.
 */
export async function claimForCopy(fileRef: FirebaseFirestore.DocumentReference): Promise<TripFileDoc | null> {
  return db.runTransaction(async (tx) => {
    const doc = (await tx.get(fileRef)).data() as TripFileDoc | undefined;
    if (!doc || doc.drive?.status === 'copied') return null;
    const lease = doc.drive?.leaseUntil?.toMillis() ?? 0;
    if (lease > Date.now()) return null;
    const attempts = (doc.drive?.attempts ?? 0) + (lease ? 1 : 0);
    if (attempts >= MAX_DRIVE_ATTEMPTS) {
      if (lease) {
        tx.update(fileRef, {
          'drive.status': 'failed',
          'drive.error': 'The copy kept stopping part way.',
          'drive.attempts': attempts,
          'drive.leaseUntil': null,
        });
      }
      return null;
    }
    tx.update(fileRef, { 'drive.attempts': attempts, 'drive.leaseUntil': Timestamp.fromMillis(Date.now() + LEASE_MS) });
    return doc;
  });
}

type CopyResult = 'copied' | 'skip' | 'not-connected' | 'waiting' | 'failed' | 'deleted';

/** Copies one recorded file (in `tripPhotos/{tripId}/files`) to Drive and records how it went. Never throws. */
async function copyFileToDrive(
  fileRef: FirebaseFirestore.DocumentReference,
  tripId: string,
  bucketName?: string,
): Promise<CopyResult> {
  const fileId = fileRef.id;
  let doc: TripFileDoc | null;
  try {
    doc = await claimForCopy(fileRef);
  } catch (err) {
    logger.error('Couldn’t take a trip photo for its Drive copy', { tripId, fileId, err });
    return 'failed';
  }
  if (!doc) return 'skip';

  let driveFileId: string | null;
  try {
    const bucket = bucketName ? getStorage().bucket(bucketName) : getStorage().bucket();
    const { name, contentType, size, storagePath } = doc;
    driveFileId = await copyToDrive({
      tripId,
      folderName: driveFolderName(tripId),
      name,
      mimeType: contentType,
      size,
      open: () => bucket.file(storagePath).createReadStream(),
    });
  } catch (err) {
    // Google not letting the site in, or Drive turning the whole account
    // away (it's full, say), isn't this file's fault: it doesn't use up a
    // try, and waits until Drive takes files again.
    const waits = err instanceof DriveAuthError || err instanceof DriveRefusedError;
    logger.error('Copying trip photo to Drive failed', { tripId, fileId, waits, err });
    await fileRef
      .update({
        'drive.status': waits ? 'not-connected' : 'failed',
        'drive.error': err instanceof Error ? err.message.slice(0, 300) : 'unknown',
        'drive.leaseUntil': null,
        'drive.lastAttemptAt': FieldValue.serverTimestamp(),
        ...(waits ? {} : { 'drive.attempts': FieldValue.increment(1) }),
      })
      // Deleted while it was copying.
      .catch(() => undefined);
    return waits ? 'waiting' : 'failed';
  }

  if (!driveFileId) {
    await fileRef.update({ 'drive.status': 'not-connected', 'drive.leaseUntil': null }).catch(() => undefined);
    logger.info('Google Drive not connected; trip photo kept for the gallery only', { tripId, fileId });
    return 'not-connected';
  }

  // Recorded only if the photo is still there. If Travis deleted it while
  // it was copying, the copy just made in Drive goes too.
  let kept: boolean;
  try {
    kept = await db.runTransaction(async (tx) => {
      if (!(await tx.get(fileRef)).exists) return false;
      tx.update(fileRef, {
        'drive.status': 'copied',
        'drive.fileId': driveFileId,
        'drive.error': null,
        'drive.leaseUntil': null,
        'drive.copiedAt': FieldValue.serverTimestamp(),
      });
      return true;
    });
  } catch (err) {
    logger.error('Recording a Drive copy failed', { tripId, fileId, driveFileId, err });
    // Unrecorded, this copy would stay in Drive beside the one the retry
    // makes, where deleting the photo never reaches it. It goes, unless the
    // record went through after all and only the answer was lost. If even
    // that can't be read, it stays: it may be the photo's only copy.
    const recorded = await fileRef
      .get()
      .then((snap) => snap.get('drive.fileId') === driveFileId)
      .catch(() => null);
    if (recorded === null) {
      logger.error('Couldn’t tell whether a Drive copy was recorded; left in Drive', { tripId, fileId, driveFileId });
    } else if (!recorded) {
      await discardDriveCopy(tripId, fileId, driveFileId);
    }
    return 'failed';
  }
  if (!kept) {
    await discardDriveCopy(tripId, fileId, driveFileId);
    return 'deleted';
  }
  return 'copied';
}

/**
 * Keeps Drive copies that no photo in Trip photos points at off the blog
 * (src/lib/blog-photos.ts leaves out exactly these): a deleted photo's
 * copy, and one that couldn't be recorded. Never throws.
 */
async function withdrawDriveCopy(tripId: string, driveFileId: string): Promise<void> {
  await db
    .collection('tripPhotos')
    .doc(tripId)
    .set({ withdrawnDriveIds: FieldValue.arrayUnion(driveFileId) }, { merge: true })
    .catch((err) => logger.error('Couldn’t keep a Drive copy off the blog', { tripId, driveFileId, err }));
}

/** Deletes a copy nothing points at; one Drive keeps is kept off the blog. */
async function discardDriveCopy(tripId: string, fileId: string, driveFileId: string): Promise<void> {
  if ((await removeDriveCopy(driveFileId, { tripId, fileId })) !== 'deleted') {
    await withdrawDriveCopy(tripId, driveFileId);
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
 * Whether a trip's photos are ready to email: from 9:00 AM ET the day after
 * the trip, once nobody has uploaded for 60 minutes.
 */
export function readyForPhotosEmail(trip: { get(field: string): unknown }, now: Date): boolean {
  const date = trip.get('date') as string;
  const last = trip.get('lastUploadAt') as Timestamp | undefined;
  return (
    // Every upload carries the trip's upload token, so a trip with files
    // has one. A trip from the old uploader, which went straight to Drive,
    // has a count but no files here: its gallery would be empty.
    !!trip.get('uploadToken') &&
    ((trip.get('photoCount') as number | undefined) ?? 0) > 0 &&
    now.getTime() >= zonedTimeToUtc(addDays(date, 1), FIRST_SEND).getTime() &&
    !!last &&
    now.getTime() - last.toMillis() >= QUIET_MS
  );
}

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

  const ready = trips.docs.filter((t) => readyForPhotosEmail(t, now));

  const baseUrl = APP_BASE_URL.value();
  const totals = { ...empty };
  for (const trip of ready) {
    const { date, timeSlot } = trip.data() as { date: string; timeSlot: TourTimeSlot };
    // Only this departure's bookings: a trip is checked every 15 minutes for
    // a week, long after everyone on it has had the email. Two equality
    // filters need no index of their own.
    const snap = await db.collection('bookings').where('date', '==', date).where('timeSlot', '==', timeSlot).get();
    // Not a departure Travis closed and left them booked on: it didn't run
    // (unless he's marked it completed since), whatever got uploaded to it.
    const parties = await onOpenDepartures(
      snap.docs
        .map((d) => ({ ...(d.data() as Booking & { photosSentAt?: unknown }), id: d.id }))
        .filter((b) => b.timeSlot === timeSlot && !b.photosSentAt && getsAutomatedEmail(b) && !!b.accessToken),
    );
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

/** Files the hourly retry takes at most; the rest wait for the next run. */
const DRIVE_RETRY_BATCH = 100;

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
    await runDriveRetry();
  },
);

/**
 * Copies to Drive every file that hasn't made it there and hasn't been
 * given up on, however old its trip: failed copies, uploads from before
 * Travis connected Drive, while Google wouldn't sign the site in or while
 * Drive was full, and copies whose function stopped part way. A copy still
 * running (the upload trigger's) is left to finish. One collection-group
 * query (an index in firestore.indexes.json) reads only those files, up to
 * {@link DRIVE_RETRY_BATCH} a run: it copies them one at a time inside a
 * 9-minute timeout, and while Drive is full it stops at the first, so
 * reading every waiting file each hour would be wasted.
 */
export async function runDriveRetry(): Promise<number> {
  if (!(await driveConnection())) return 0;
  const waiting = await db
    .collectionGroup(FILES)
    .where('drive.status', 'in', ['pending', 'failed', 'not-connected'])
    .where('drive.attempts', '<', MAX_DRIVE_ATTEMPTS)
    .limit(DRIVE_RETRY_BATCH)
    .get();
  let copied = 0;
  for (const f of waiting.docs) {
    const tripId = f.ref.parent.parent?.id;
    if (!tripId) continue;
    const result = await copyFileToDrive(f.ref, tripId);
    if (result === 'copied') copied++;
    // Signed out, disconnected, or Drive full: the rest would go the same
    // way. They wait, without using up a try, for the next run.
    if (result === 'waiting' || result === 'not-connected') {
      logger.warn('Drive retry stopped: Google Drive isn’t taking files', { copied });
      return copied;
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
 * Deletes a Drive copy no photo points at any more: 'deleted', or why it's
 * still in Drive. Nothing tries again later, so Trip photos says so after a
 * delete. Never throws.
 */
export async function removeDriveCopy(
  driveFileId: string,
  log: { tripId: string; fileId: string },
): Promise<'deleted' | 'not-connected' | 'failed'> {
  try {
    return (await deleteDriveFile(driveFileId)) ? 'deleted' : 'not-connected';
  } catch (err) {
    logger.error('Deleting the Drive copy failed', { ...log, driveFileId, err });
    return 'failed';
  }
}

/** A blog post a photo is on: live, or a draft waiting for Travis's OK. */
export interface PostWithPhoto {
  slug: string;
  title: string;
  status: 'published' | 'pending-review' | 'hidden';
  /**
   * A post taken off the website: whether its own copy of the photo was
   * deleted with it (deleteHiddenPostCopy). False if that failed.
   */
  copyDeleted?: boolean;
}

/**
 * The blog posts a Drive photo is on. A post has its own copy of each
 * photo (src/lib/blog-photos.ts), so deleting the trip photo doesn't take
 * it off one: Travis has to. Null if the posts couldn't be read.
 */
export async function postsWithPhoto(driveFileId: string): Promise<PostWithPhoto[] | null> {
  try {
    const snap = await db
      .collection('newsPosts')
      .where('photoIds', 'array-contains', driveFileId)
      .select('title', 'status')
      .get();
    return snap.docs
      // Hidden too: one tap puts a post Travis took off the website back up.
      .filter((d) => ['published', 'pending-review', 'hidden'].includes(d.get('status') as string))
      .map((d) => ({ slug: d.id, title: (d.get('title') as string | undefined) ?? d.id, status: d.get('status') }));
  } catch (err) {
    logger.error('Couldn’t check the blog for a deleted trip photo', { driveFileId, err });
    return null;
  }
}

/**
 * Deletes a hidden blog post's own copy of a photo just deleted here, so
 * its web address stops working too: the post's page, its social card and
 * Google's copy of its markup all named it, and the post can't go back on
 * the website with it anyway (hasWithdrawnPhoto in src/lib/blog-publish.ts;
 * deleteWithdrawnCopies there does this when Travis takes a post down
 * after deleting the photo). A live post isn't touched: that would break it on
 * the website, and Trip photos tells Travis to take it down. The paths go
 * on the post (`removedImagePaths`), so Admin → Blog shows a stand-in for
 * a hero that's gone. Whether the copy is gone. Never throws.
 */
async function deleteHiddenPostCopy(slug: string, driveFileId: string): Promise<boolean> {
  try {
    const ref = db.collection('newsPosts').doc(slug);
    const post = (await ref.get()).data() as (StoredPhotos & { status?: string; removedImagePaths?: string[] }) | undefined;
    // Put back up since the posts were read: leave it whole.
    if (!post || post.status !== 'hidden') return false;
    const removed = new Set(post.removedImagePaths ?? []);
    const paths = storedCopiesOf(post, [driveFileId]).filter((p) => !removed.has(p));
    const bucket = getStorage().bucket();
    await Promise.all(paths.map((p) => bucket.file(p).delete({ ignoreNotFound: true })));
    if (paths.length) await ref.update({ removedImagePaths: FieldValue.arrayUnion(...paths) });
    return true;
  } catch (err) {
    logger.error('Couldn’t delete a hidden blog post’s copy of a deleted trip photo', { slug, driveFileId, err });
    return false;
  }
}

/**
 * Takes a photo out of the guest gallery and deletes the file, and its
 * Drive copy if there is one. Null if it's already gone. `drive` says how
 * the Drive copy went (null: there wasn't one); `blogPosts`, the posts it's
 * still on. A post already taken off the website loses its own copy of the
 * photo here (deleteHiddenPostCopy), and says whether it did.
 */
export async function deleteTripPhoto(
  tripId: string,
  fileId: string,
): Promise<{
  doc: TripFileDoc;
  driveFileId: string | null;
  drive: Awaited<ReturnType<typeof removeDriveCopy>> | null;
  blogPosts: PostWithPhoto[] | null;
} | null> {
  const tripRef = db.collection('tripPhotos').doc(tripId);
  const fileRef = tripRef.collection(FILES).doc(fileId);
  const doc = (await fileRef.get()).data() as TripFileDoc | undefined;
  if (!doc) return null;

  await getStorage()
    .bucket()
    .file(doc.storagePath)
    .delete()
    .catch((err: { code?: number }) => {
      if (err.code !== 404) throw err;
    });
  const deleted = await db.runTransaction(async (tx) => {
    const snap = await tx.get(fileRef);
    if (!snap.exists) return null;
    const data = snap.data() as TripFileDoc;
    const copy = data.drive?.fileId;
    tx.delete(fileRef);
    // Its Drive copy is off the blog from now on, whether or not Drive lets
    // go of it below (src/lib/blog-photos.ts leaves these out).
    tx.set(
      tripRef,
      { photoCount: FieldValue.increment(-1), ...(copy && { withdrawnDriveIds: FieldValue.arrayUnion(copy) }) },
      { merge: true },
    );
    return data;
  });
  // The Drive copy as it stood at the delete, so one that finished copying
  // since the read above goes too. One still copying deletes itself when
  // it finds the photo gone (copyFileToDrive).
  const driveFileId = (deleted ?? doc).drive?.fileId ?? null;
  const [drive, posts] = driveFileId
    ? await Promise.all([removeDriveCopy(driveFileId, { tripId, fileId }), postsWithPhoto(driveFileId)])
    : [null, []];
  const blogPosts =
    posts &&
    (await Promise.all(
      posts.map(async (p) => (p.status === 'hidden' ? { ...p, copyDeleted: await deleteHiddenPostCopy(p.slug, driveFileId!) } : p)),
    ));
  return { doc, driveFileId, drive, blogPosts };
}

/**
 * POST /adminDeleteTripPhoto { tripId, fileId }
 *
 * Deletes a trip photo (deleteTripPhoto). `driveCopyLeft` says why a Drive
 * copy couldn't be deleted ('not-connected' or 'failed'), else null.
 * `blogPosts`: the blog posts it's still on, or null if that couldn't be
 * checked; one taken off the website says whether its own copy was deleted
 * too (`copyDeleted`).
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

    const result = await deleteTripPhoto(tripId, fileId);
    if (!result) {
      res.status(404).json({ error: 'That photo is already gone.' });
      return;
    }
    const { doc, driveFileId, drive, blogPosts } = result;
    const driveDeleted = drive === 'deleted';
    // Why the Drive copy is still there, if it is: Trip photos tells Travis
    // to delete it by hand.
    const driveCopyLeft = drive === 'deleted' ? null : drive;

    await writeAudit({
      admin,
      action: 'tripPhoto.delete',
      targetId: tripId,
      payload: {
        fileId,
        name: doc.name,
        storagePath: doc.storagePath,
        driveFileId,
        driveDeleted,
        driveCopyLeft,
        blogPosts: blogPosts?.map((p) => p.slug) ?? null,
        // Taken off the website already, and their copy of it deleted now.
        blogCopiesDeleted: blogPosts?.filter((p) => p.copyDeleted).map((p) => p.slug) ?? [],
      },
    });
    res.status(200).json({ ok: true, driveDeleted, driveCopyLeft, blogPosts });
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
          // Every departure, the sunset cruise included.
          timeSlot: z.enum(Object.keys(slotLabels) as [TourTimeSlot, ...TourTimeSlot[]]),
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

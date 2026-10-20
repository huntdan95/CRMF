import 'server-only';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { holdsItsPlace } from './blog-rules';
import { adminDb, adminStorage } from './firebase/admin';
import type { NewsImage, NewsPostStatus } from './firebase/types';
import {
  DriveError,
  downloadFile,
  downloadThumbnail,
  getImage,
  isDriveConfigured,
  listImagesAndFolders,
  serviceAccount,
  serviceAccountEmail,
  siteAccount,
  type DriveIdentity,
  type DriveImage,
} from './google-drive';
import { slotLabels, type TourTimeSlot } from './tours';

/*
 * Photos for grokbot's blog posts, from Travis's Google Drive:
 *
 *  - `trip/<id>`: the GoPro shots crew upload to each trip's folder
 *    (src/lib/trip-photos-server.ts). The site created those files, so it
 *    can read them with the account it already has. Nothing to set up.
 *  - `library/<id>`: any folder Travis shares (Viewer) with the site's
 *    service account (serviceAccountEmail()). Sub-folders count too.
 *
 * A photo goes on a post as a copy in Storage
 * (`public/news/<slug>/<draft>/`, a folder per draft so a resubmitted slug
 * never overwrites or deletes another draft's files),
 * resized, turned upright and stripped of its EXIF data (camera details and
 * GPS position). The featured photo is cut to 16:9, 4:3 and 1:1, the shapes
 * Google asks for in Article markup.
 */

export type PhotoSource = 'trip' | 'library';

export interface BlogPhoto {
  /** What the MCP tools take: `trip/<driveId>` or `library/<driveId>`. */
  id: string;
  source: PhotoSource;
  name: string;
  /** Where it came from: the trip, or the shared folder's path. */
  folder: string;
  takenAt: string | null;
  /** As displayed (EXIF rotation applied). */
  width: number | null;
  height: number | null;
  /** The post that already used it, if any. */
  usedIn: string | null;
}

/** Trips whose photos are offered, newest first. */
const TRIP_LOOKBACK = 40;
/** Trip docs read at a time while looking for those (one without photos is skipped). */
const TRIP_PAGE = 100;
/** How deep shared folders are walked, and how many at most. */
const LIBRARY_DEPTH = 3;
const LIBRARY_MAX_FOLDERS = 60;
/** Smaller than this isn't worth putting on a post. */
const LIST_MIN_WIDTH = 800;

const HERO_CROPS = [
  { label: '16x9', width: 1600, height: 900 },
  { label: '4x3', width: 1600, height: 1200 },
  { label: '1x1', width: 1200, height: 1200 },
] as const;
const BODY_MAX_WIDTH = 1600;
const PREVIEW_SIZE = 1024;

export function parsePhotoId(id: string): { source: PhotoSource; driveId: string } | null {
  const match = /^(trip|library)\/([A-Za-z0-9_-]{10,})$/.exec(id.trim());
  return match ? { source: match[1] as PhotoSource, driveId: match[2]! } : null;
}

function identity(source: PhotoSource): DriveIdentity {
  return source === 'trip' ? siteAccount : serviceAccount;
}

function displaySize(image: DriveImage): { width: number | null; height: number | null } {
  const m = image.imageMediaMetadata;
  if (!m?.width || !m.height) return { width: null, height: null };
  return m.rotation === 1 || m.rotation === 3 ? { width: m.height, height: m.width } : { width: m.width, height: m.height };
}

function toPhoto(source: PhotoSource, image: DriveImage, folder: string, usedIn: string | null): BlogPhoto {
  const raw = image.imageMediaMetadata?.time;
  // EXIF time is "2026:10:17 08:42:10", camera-local.
  const exif = raw && /^\d{4}:\d{2}:\d{2} /.test(raw) ? raw.replace(/^(\d{4}):(\d{2}):(\d{2}) /, '$1-$2-$3T') : null;
  return {
    id: `${source}/${image.id}`,
    source,
    name: image.name,
    folder,
    takenAt: exif ?? image.createdTime ?? null,
    ...displaySize(image),
    usedIn,
  };
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!);
      }
    }),
  );
  return out;
}

/** Drive photo id → slug of the post that used it (declined drafts don't count). */
async function usedPhotos(): Promise<Map<string, string>> {
  const snap = await adminDb().collection('newsPosts').select('photoIds', 'status', 'submittedAt').get();
  const used = new Map<string, string>();
  for (const d of snap.docs) {
    if (!holdsItsPlace(d.get('status') as NewsPostStatus, d.get('submittedAt')?.toMillis?.() ?? 0)) continue;
    for (const id of (d.get('photoIds') as string[] | undefined) ?? []) used.set(id, d.id);
  }
  return used;
}

type TripFolder = { id: string; date: string; timeSlot?: TourTimeSlot; folderId: string };

/** The newest {@link TRIP_LOOKBACK} trips with photos, newest first, without reading every trip there ever was. */
async function recentTripFolders(): Promise<TripFolder[]> {
  // Every trip doc has a date: ensureTripFolder writes it with the folder.
  const newestFirst = adminDb()
    .collection('tripPhotos')
    .orderBy('date', 'desc')
    .select('date', 'timeSlot', 'folderId', 'photoCount')
    .limit(TRIP_PAGE);
  const trips: TripFolder[] = [];
  let snap = await newestFirst.get();
  for (;;) {
    for (const d of snap.docs) {
      const folderId = d.get('folderId') as string | undefined;
      const photoCount = d.get('photoCount') as number | undefined;
      if (!folderId || !(typeof photoCount === 'number' && photoCount > 0)) continue;
      const timeSlot = d.get('timeSlot') as TourTimeSlot | undefined;
      trips.push({ id: d.id, date: d.get('date') as string, timeSlot, folderId });
    }
    if (trips.length >= TRIP_LOOKBACK || snap.size < TRIP_PAGE) return trips.slice(0, TRIP_LOOKBACK);
    snap = await newestFirst.startAfter(snap.docs[snap.docs.length - 1]!).get();
  }
}

async function tripPhotos(used: Map<string, string>): Promise<BlogPhoto[]> {
  const trips = await recentTripFolders();

  const listings = await mapLimit(trips, 5, async (t) => {
    try {
      return (await listImagesAndFolders(siteAccount, `'${t.folderId}' in parents`)).images;
    } catch (err) {
      // A trip folder deleted in Drive: skip it.
      if (err instanceof DriveError && err.status === 404) return [];
      throw err;
    }
  });
  return trips.flatMap((t, i) => {
    const label = `Trip ${t.date}${t.timeSlot ? `, ${slotLabels[t.timeSlot]}` : ''}`;
    return listings[i]!.map((img) => toPhoto('trip', img, label, used.get(img.id) ?? null));
  });
}

async function libraryPhotos(used: Map<string, string>): Promise<BlogPhoto[]> {
  const top = await listImagesAndFolders(serviceAccount, 'sharedWithMe = true');
  const photos = top.images.map((img) => toPhoto('library', img, 'Shared with the site', used.get(img.id) ?? null));
  const queue = top.folders.map((f) => ({ ...f, path: f.name, depth: 1 }));
  const seen = new Set<string>();
  while (queue.length && seen.size < LIBRARY_MAX_FOLDERS) {
    const batch = queue.splice(0, 5).filter((f) => !seen.has(f.id));
    batch.forEach((f) => seen.add(f.id));
    const listings = await Promise.all(batch.map((f) => listImagesAndFolders(serviceAccount, `'${f.id}' in parents`)));
    batch.forEach((f, i) => {
      const { images, folders } = listings[i]!;
      photos.push(...images.map((img) => toPhoto('library', img, f.path, used.get(img.id) ?? null)));
      if (f.depth < LIBRARY_DEPTH) {
        queue.push(...folders.map((sub) => ({ ...sub, path: `${f.path}/${sub.name}`, depth: f.depth + 1 })));
      }
    });
  }
  return photos;
}

export interface PhotoListing {
  photos: BlogPhoto[];
  /** Total matching before the limit. */
  total: number;
  /** Setup problems worth telling the person about. */
  notes: string[];
  /** The address Travis shares photo folders with. */
  shareWith: string | null;
}

/**
 * Photos grokbot can use: unused ones first, newest first. A photo in both
 * places (Travis shared the trip-photos folder too) is listed once.
 */
export async function listBlogPhotos(opts: { limit: number; includeUsed: boolean; search?: string }): Promise<PhotoListing> {
  const used = await usedPhotos();
  const notes: string[] = [];
  const shareWith = await serviceAccountEmail();

  const [trips, library] = await Promise.all([
    isDriveConfigured()
      ? tripPhotos(used).catch((err) => {
          console.error('Blog photos: trip folders unreadable', err);
          notes.push('Trip photos couldn’t be read from Google Drive (it may need reconnecting: npm run connect:drive).');
          return [];
        })
      : (notes.push('Trip photos: Google Drive isn’t connected on this site yet.'), Promise.resolve([])),
    libraryPhotos(used).catch((err) => {
      console.error('Blog photos: shared folders unreadable', err);
      notes.push('Shared photo folders couldn’t be read (the service account’s Drive access failed).');
      return null;
    }),
  ]);
  if (library?.length === 0) {
    notes.push(
      shareWith
        ? `No photo folders are shared with the site yet. Share a Drive folder with ${shareWith} (Viewer) to add Travis’s own photos.`
        : 'No photo folders are shared with the site yet.',
    );
  }

  const byDriveId = new Map<string, BlogPhoto>();
  for (const p of [...trips, ...(library ?? [])]) {
    const driveId = p.id.slice(p.source.length + 1);
    if (!byDriveId.has(driveId)) byDriveId.set(driveId, p);
  }
  const needle = opts.search?.trim().toLowerCase();
  const all = [...byDriveId.values()]
    .filter((p) => p.width === null || p.width >= LIST_MIN_WIDTH)
    .filter((p) => opts.includeUsed || !p.usedIn)
    .filter((p) => !needle || `${p.name} ${p.folder}`.toLowerCase().includes(needle))
    .sort((a, b) => Number(Boolean(a.usedIn)) - Number(Boolean(b.usedIn)) || (b.takenAt ?? '').localeCompare(a.takenAt ?? ''));
  return { photos: all.slice(0, opts.limit), total: all.length, notes, shareWith };
}

/** One photo's details, or null if it's gone or the site can't see it. */
export async function getBlogPhoto(id: string): Promise<{ photo: BlogPhoto; image: DriveImage } | null> {
  const parsed = parsePhotoId(id);
  if (!parsed) return null;
  try {
    const image = await getImage(identity(parsed.source), parsed.driveId);
    if (!image.mimeType.startsWith('image/')) return null;
    return { photo: toPhoto(parsed.source, image, '', null), image };
  } catch (err) {
    if (err instanceof DriveError && (err.status === 404 || err.status === 403)) return null;
    throw err;
  }
}

/** The photo's pixels, in a format sharp can read. */
async function pixels(source: PhotoSource, image: DriveImage): Promise<Buffer> {
  // Drive renders anything else (an iPhone's HEIC, say) as a JPEG for us.
  if (/^image\/(jpeg|png|webp)$/.test(image.mimeType)) {
    return downloadFile(identity(source), image.id);
  }
  return downloadThumbnail(identity(source), image, 2048);
}

/** A small JPEG for a model to look at before choosing. */
export async function previewBlogPhoto(id: string): Promise<{ photo: BlogPhoto; jpeg: Buffer } | null> {
  const found = await getBlogPhoto(id);
  if (!found) return null;
  const input = await pixels(found.photo.source, found.image);
  const jpeg = await sharp(input)
    .rotate()
    .resize(PREVIEW_SIZE, PREVIEW_SIZE, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 70 })
    .toBuffer();
  return { photo: found.photo, jpeg };
}

/** "Mother manatee and calf resting in Kings Bay" → "mother-manatee-and-calf-resting-in-kings-bay". */
export function fileSlug(text: string, max = 60): string {
  const slug = text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (slug.length <= max) return slug || 'photo';
  // Cut at a word boundary.
  const cut = slug.slice(0, max + 1);
  return cut.includes('-') ? cut.replace(/-[^-]*$/, '') : slug.slice(0, max);
}

async function upload(path: string, data: Buffer): Promise<string> {
  const bucket = adminStorage().bucket();
  const token = randomUUID();
  await bucket.file(path).save(data, {
    resumable: false,
    contentType: 'image/jpeg',
    metadata: {
      cacheControl: 'public, max-age=31536000, immutable',
      // The same kind of download URL the admin photo uploads get.
      metadata: { firebaseStorageDownloadTokens: token },
    },
  });
  return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
}

async function store(input: Buffer, path: string, alt: string, pipeline: (s: sharp.Sharp) => sharp.Sharp): Promise<NewsImage> {
  // sharp leaves EXIF (and its GPS position) out of the output by default.
  const { data, info } = await pipeline(sharp(input).rotate())
    .jpeg({ quality: 80, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });
  return { url: await upload(path, data), storagePath: path, width: info.width, height: info.height, alt };
}

/** Copies the featured photo into `folder` as its three crops; the 16:9 one comes first. */
export async function importHeroPhoto(id: string, alt: string, folder: string, used: Set<string>): Promise<NewsImage[]> {
  const found = await getBlogPhoto(id);
  if (!found) throw new Error(`Photo ${id} isn’t available any more.`);
  const input = await pixels(found.photo.source, found.image);
  const meta = await sharp(input).metadata();
  // EXIF orientations 5–8 are quarter turns: the upright photo is the other way round.
  const [srcW, srcH] = (meta.orientation ?? 1) >= 5 ? [meta.height!, meta.width!] : [meta.width!, meta.height!];
  const base = uniqueName(fileSlug(alt), used);
  const out: NewsImage[] = [];
  for (const crop of HERO_CROPS) {
    // Shrink the crop box (never the photo) to fit, so the shape stays exact.
    const scale = Math.min(1, srcW / crop.width, srcH / crop.height);
    const width = Math.round(crop.width * scale);
    const height = Math.round(crop.height * scale);
    out.push(
      await store(input, `${folder}/${base}-${crop.label}.jpg`, alt, (s) =>
        s.resize(width, height, { fit: 'cover', position: sharp.strategy.attention }),
      ),
    );
  }
  return out;
}

export async function importBodyPhoto(id: string, alt: string, folder: string, used: Set<string>): Promise<NewsImage> {
  const found = await getBlogPhoto(id);
  if (!found) throw new Error(`Photo ${id} isn’t available any more.`);
  const input = await pixels(found.photo.source, found.image);
  return store(input, `${folder}/${uniqueName(fileSlug(alt), used)}.jpg`, alt, (s) =>
    s.resize({ width: BODY_MAX_WIDTH, withoutEnlargement: true }),
  );
}

/** Removes a declined or expired draft's photos from Storage. */
export async function deleteStoredImages(images: NewsImage[]): Promise<void> {
  const bucket = adminStorage().bucket();
  await Promise.all(
    images.map((i) => bucket.file(i.storagePath).delete({ ignoreNotFound: true }).catch((err) => console.error('Blog: couldn’t delete', i.storagePath, err))),
  );
}

function uniqueName(base: string, used: Set<string>): string {
  let name = base;
  for (let n = 2; used.has(name); n++) name = `${base}-${n}`;
  used.add(name);
  return name;
}

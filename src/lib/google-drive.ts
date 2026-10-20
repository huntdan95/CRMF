import 'server-only';
import { createSign } from 'node:crypto';

/*
 * Minimal Google Drive client, over plain fetch. It reaches Drive as one of
 * two identities:
 *
 *  - `siteAccount`: one Google account (whoever ran `npm run
 *    connect:drive`, normally Travis) with the `drive.file` scope. It can
 *    only see and change files it created itself — the trip-photo folders
 *    and what goes in them — never the rest of that Drive. Needs three App
 *    Hosting env vars (see apphosting.yaml):
 *      GOOGLE_DRIVE_CLIENT_ID, GOOGLE_DRIVE_CLIENT_SECRET, GOOGLE_DRIVE_REFRESH_TOKEN
 *
 *  - `serviceAccount`: the site's own Google Cloud service account, read-only.
 *    It sees only what someone has shared with its email address, which is
 *    how Travis hands the blog a folder of his own photos
 *    (src/lib/blog-photos.ts). No setup beyond the share.
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const FILES_URL = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

export class DriveError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'DriveError';
  }
}

export function isDriveConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_DRIVE_CLIENT_ID &&
      process.env.GOOGLE_DRIVE_CLIENT_SECRET &&
      process.env.GOOGLE_DRIVE_REFRESH_TOKEN,
  );
}

/** Returns a Drive access token for one identity. */
export type DriveIdentity = () => Promise<string>;

let cachedToken: { value: string; expiresAt: number } | null = null;

async function accessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.value;
  }
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: process.env.GOOGLE_DRIVE_CLIENT_ID ?? '',
      client_secret: process.env.GOOGLE_DRIVE_CLIENT_SECRET ?? '',
      refresh_token: process.env.GOOGLE_DRIVE_REFRESH_TOKEN ?? '',
    }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
  };
  if (!res.ok || !body.access_token) {
    // `invalid_grant` = the Google account revoked access or the token
    // expired; `npm run connect:drive` again to get a new one.
    throw new DriveError(`Google token refresh failed: ${body.error ?? res.status}`, res.status);
  }
  cachedToken = {
    value: body.access_token,
    expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
  };
  return cachedToken.value;
}

export const siteAccount: DriveIdentity = accessToken;

// ---------------------------------------------------------------------------
// The service account
// ---------------------------------------------------------------------------

const METADATA = 'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default';
const READONLY_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';

let cachedServiceToken: { value: string; expiresAt: number } | null = null;

/**
 * Locally, the FIREBASE_ADMIN_* key from .env.local signs its own token
 * request. On App Hosting (Cloud Run), the metadata server mints one for the
 * backend's service account with the Drive scope.
 */
async function serviceAccountToken(): Promise<string> {
  if (cachedServiceToken && cachedServiceToken.expiresAt > Date.now() + 60_000) {
    return cachedServiceToken.value;
  }
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n');
  let res: Response;
  if (clientEmail && privateKey) {
    const now = Math.floor(Date.now() / 1000);
    const encode = (v: object) => Buffer.from(JSON.stringify(v)).toString('base64url');
    const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({
      iss: clientEmail,
      scope: READONLY_SCOPE,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    })}`;
    const signature = createSign('RSA-SHA256').update(unsigned).sign(privateKey).toString('base64url');
    res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: `${unsigned}.${signature}`,
      }),
    });
  } else {
    res = await fetch(`${METADATA}/token?scopes=${encodeURIComponent(READONLY_SCOPE)}`, {
      headers: { 'Metadata-Flavor': 'Google' },
      signal: AbortSignal.timeout(5000),
    }).catch(() => new Response(null, { status: 503 }));
  }
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
  if (!res.ok || !body.access_token) {
    throw new DriveError(`Service account token failed: ${body.error ?? res.status}`, res.status);
  }
  cachedServiceToken = { value: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 };
  return cachedServiceToken.value;
}

export const serviceAccount: DriveIdentity = serviceAccountToken;

/** The address to share a Drive folder with, or null if it can't be worked out here. */
export async function serviceAccountEmail(): Promise<string | null> {
  if (process.env.FIREBASE_ADMIN_CLIENT_EMAIL) return process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  try {
    const res = await fetch(`${METADATA}/email`, {
      headers: { 'Metadata-Flavor': 'Google' },
      signal: AbortSignal.timeout(2000),
    });
    return res.ok ? (await res.text()).trim() : null;
  } catch {
    return null;
  }
}

async function drive<T>(url: string, init: RequestInit = {}, identity: DriveIdentity = siteAccount): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${await identity()}`,
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new DriveError(`Drive ${init.method ?? 'GET'} failed (${res.status}): ${text.slice(0, 300)}`, res.status);
  }
  return (res.status === 204 ? null : await res.json()) as T;
}

export interface DriveFile {
  id: string;
  webViewLink?: string;
  trashed?: boolean;
}

export function createFolder(name: string, parentId?: string): Promise<DriveFile> {
  return drive<DriveFile>(`${FILES_URL}?fields=id,webViewLink`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      mimeType: FOLDER_MIME,
      ...(parentId ? { parents: [parentId] } : {}),
    }),
  });
}

/** The file, or null if it's gone or in the trash. */
export async function getLiveFile(id: string): Promise<DriveFile | null> {
  try {
    const file = await drive<DriveFile>(`${FILES_URL}/${encodeURIComponent(id)}?fields=id,trashed,webViewLink`);
    return file.trashed ? null : file;
  } catch (err) {
    if (err instanceof DriveError && err.status === 404) return null;
    throw err;
  }
}

export async function deleteFile(id: string): Promise<void> {
  await drive<null>(`${FILES_URL}/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/**
 * Creates a small text file in `parentId`, or replaces the contents of
 * `existingId` when given (and still there).
 */
export async function writeTextFile(opts: {
  name: string;
  parentId: string;
  mimeType: string;
  content: string;
  existingId?: string | null;
}): Promise<DriveFile> {
  if (opts.existingId && (await getLiveFile(opts.existingId))) {
    return drive<DriveFile>(
      `${UPLOAD_URL}/${encodeURIComponent(opts.existingId)}?uploadType=media&fields=id`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': opts.mimeType },
        body: opts.content,
      },
    );
  }

  const boundary = `crmf${crypto.randomUUID()}`;
  const body = [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    JSON.stringify({ name: opts.name, parents: [opts.parentId], mimeType: opts.mimeType }),
    `--${boundary}`,
    `Content-Type: ${opts.mimeType}`,
    '',
    opts.content,
    `--${boundary}--`,
  ].join('\r\n');
  return drive<DriveFile>(`${UPLOAD_URL}?uploadType=multipart&fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
}

/**
 * Starts a resumable upload into `parentId` and returns the session URL.
 * The phone then PUTs the file straight to Google at that URL — no token
 * needed, and the photo never passes through our server. Google only
 * accepts that cross-origin PUT from `origin`, so it has to be the
 * page's origin.
 */
export async function startResumableUpload(opts: {
  name: string;
  parentId: string;
  mimeType: string;
  size: number;
  origin: string;
}): Promise<string> {
  const res = await fetch(`${UPLOAD_URL}?uploadType=resumable&fields=id`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${await accessToken()}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': opts.mimeType,
      'X-Upload-Content-Length': String(opts.size),
      Origin: opts.origin,
    },
    body: JSON.stringify({ name: opts.name, parents: [opts.parentId] }),
  });
  const location = res.headers.get('location');
  if (!res.ok || !location) {
    const text = await res.text().catch(() => '');
    throw new DriveError(`Starting the upload failed (${res.status}): ${text.slice(0, 300)}`, res.status);
  }
  return location;
}

// ---------------------------------------------------------------------------
// Reading photos (the blog)
// ---------------------------------------------------------------------------

export interface DriveImage {
  id: string;
  name: string;
  mimeType: string;
  createdTime?: string;
  thumbnailLink?: string;
  imageMediaMetadata?: { width?: number; height?: number; rotation?: number; time?: string };
}

export interface DriveListing {
  images: DriveImage[];
  folders: { id: string; name: string }[];
}

/** So a folder on a shared drive works as well as one in My Drive. */
const ALL_DRIVES = 'supportsAllDrives=true';

const LISTED_FIELDS =
  'nextPageToken,files(id,name,mimeType,createdTime,thumbnailLink,imageMediaMetadata(width,height,rotation,time))';

/** Images and sub-folders matching a Drive query (`q`), every page of them. */
export async function listImagesAndFolders(identity: DriveIdentity, q: string): Promise<DriveListing> {
  const out: DriveListing = { images: [], folders: [] };
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({
      q: `(${q}) and trashed = false and (mimeType contains 'image/' or mimeType = '${FOLDER_MIME}')`,
      fields: LISTED_FIELDS,
      pageSize: '1000',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
      ...(pageToken && { pageToken }),
    });
    const page = await drive<{ nextPageToken?: string; files?: DriveImage[] }>(`${FILES_URL}?${params}`, {}, identity);
    for (const f of page.files ?? []) {
      if (f.mimeType === FOLDER_MIME) out.folders.push({ id: f.id, name: f.name });
      else out.images.push(f);
    }
    pageToken = page.nextPageToken;
  } while (pageToken);
  return out;
}

export function getImage(identity: DriveIdentity, id: string): Promise<DriveImage> {
  const fields = 'id,name,mimeType,createdTime,thumbnailLink,imageMediaMetadata(width,height,rotation,time)';
  return drive<DriveImage>(`${FILES_URL}/${encodeURIComponent(id)}?${ALL_DRIVES}&fields=${encodeURIComponent(fields)}`, {}, identity);
}

/** The file's bytes. */
export async function downloadFile(identity: DriveIdentity, id: string): Promise<Buffer> {
  const res = await fetch(`${FILES_URL}/${encodeURIComponent(id)}?alt=media&${ALL_DRIVES}`, {
    headers: { Authorization: `Bearer ${await identity()}` },
  });
  if (!res.ok) {
    throw new DriveError(`Drive download failed (${res.status})`, res.status);
  }
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Drive's own JPEG rendering of an image, `size` pixels on the long side.
 * Works for formats sharp can't open (an iPhone's HEIC).
 */
export async function downloadThumbnail(identity: DriveIdentity, image: DriveImage, size: number): Promise<Buffer> {
  if (!image.thumbnailLink) throw new DriveError('Drive has no preview for this file', 404);
  const url = image.thumbnailLink.replace(/=s\d+$/, `=s${size}`);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${await identity()}` } });
  if (!res.ok) throw new DriveError(`Drive preview failed (${res.status})`, res.status);
  return Buffer.from(await res.arrayBuffer());
}

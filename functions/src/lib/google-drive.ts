import { Readable } from 'node:stream';
import { logger } from 'firebase-functions/v2';

import { db, FieldValue } from './firebase';

/*
 * Copies trip photos into Travis's Google Drive, under "Manatee Fun Trip
 * Photos", one folder per departure, so Grok Bot can use them for social
 * posts (the blog's photo picker reads the same folders,
 * src/lib/blog-photos.ts).
 *
 * The Drive connection has only the `drive.file` scope: the site can see
 * and change only the folders and files it created, never the rest of the
 * Drive. The website stores what the functions need in `driveConfig/oauth`
 * (server-only): the OAuth client id and secret and the refresh token,
 * from `npm run connect:drive` or Admin → Settings (src/lib/google-drive.ts).
 *
 * Nothing here is allowed to break the gallery: callers catch and log.
 */

export const ROOT_FOLDER_NAME = 'Manatee Fun Trip Photos';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

/**
 * Google's endpoints. Local testing can point them at a fake, but only
 * against the emulator: production never reads these variables.
 */
function origins() {
  const local = !!process.env.FIRESTORE_EMULATOR_HOST;
  return {
    api: (local && process.env.GOOGLE_API_ORIGIN) || 'https://www.googleapis.com',
    oauth: (local && process.env.GOOGLE_OAUTH_ORIGIN) || 'https://oauth2.googleapis.com',
  };
}

export class DriveError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'DriveError';
  }
}

interface Connection {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

const CONNECTION_DOC = 'driveConfig/oauth';

/** Travis's Drive connection, or null if he hasn't connected (or disconnected). */
export async function driveConnection(): Promise<Connection | null> {
  const data = (await db.doc(CONNECTION_DOC).get()).data();
  if (!data?.refreshToken || !data.clientId || !data.clientSecret) return null;
  return { clientId: data.clientId, clientSecret: data.clientSecret, refreshToken: data.refreshToken };
}

let cached: { refreshToken: string; value: string; expiresAt: number } | null = null;

async function accessToken(conn: Connection): Promise<string> {
  if (cached && cached.refreshToken === conn.refreshToken && cached.expiresAt > Date.now() + 60_000) {
    return cached.value;
  }
  const res = await fetch(`${origins().oauth}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: conn.clientId,
      client_secret: conn.clientSecret,
      refresh_token: conn.refreshToken,
    }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
  };
  if (!res.ok || !body.access_token) {
    // `invalid_grant`: Travis removed the site's access in his Google
    // account. Settings shows it so he can connect again.
    await db
      .doc(CONNECTION_DOC)
      .set({ lastError: `Google sign-in failed: ${body.error ?? res.status}`, lastErrorAt: FieldValue.serverTimestamp() }, { merge: true })
      .catch(() => undefined);
    throw new DriveError(`Google token refresh failed: ${body.error ?? res.status}`, res.status);
  }
  cached = {
    refreshToken: conn.refreshToken,
    value: body.access_token,
    expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
  };
  return cached.value;
}

async function drive<T>(conn: Connection, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${origins().api}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${await accessToken(conn)}`, ...(init.headers ?? {}) },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new DriveError(`Drive ${init.method ?? 'GET'} ${path.split('?')[0]} failed (${res.status}): ${text.slice(0, 300)}`, res.status);
  }
  return (res.status === 204 ? null : await res.json()) as T;
}

interface DriveFile {
  id: string;
  webViewLink?: string;
  trashed?: boolean;
}

function createFolder(conn: Connection, name: string, parentId?: string): Promise<DriveFile> {
  return drive<DriveFile>(conn, '/drive/v3/files?fields=id,webViewLink', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, ...(parentId ? { parents: [parentId] } : {}) }),
  });
}

/** The file, or null if it's gone or in the trash. */
async function liveFile(conn: Connection, id: string): Promise<DriveFile | null> {
  try {
    const file = await drive<DriveFile>(conn, `/drive/v3/files/${encodeURIComponent(id)}?fields=id,trashed,webViewLink`);
    return file.trashed ? null : file;
  } catch (err) {
    if (err instanceof DriveError && err.status === 404) return null;
    throw err;
  }
}

export async function deleteDriveFile(id: string): Promise<void> {
  const conn = await driveConnection();
  if (!conn) return;
  try {
    await drive<null>(conn, `/drive/v3/files/${encodeURIComponent(id)}`, { method: 'DELETE' });
  } catch (err) {
    if (err instanceof DriveError && err.status === 404) return;
    throw err;
  }
}

/**
 * A folder recorded at `docPath.field`, made if it's missing or Travis
 * trashed it. Two uploads at once may both make one; the transaction keeps
 * one and the other is deleted.
 */
async function ensureFolder(
  conn: Connection,
  docPath: string,
  field: string,
  name: string,
  parentId?: string,
): Promise<string> {
  const ref = db.doc(docPath);
  const existing = (await ref.get()).get(field) as string | undefined;
  if (existing && (await liveFile(conn, existing))) return existing;

  const folder = await createFolder(conn, name, parentId);
  const kept = await db.runTransaction(async (tx) => {
    const current = (await tx.get(ref)).get(field) as string | undefined;
    if (current && current !== existing) return current;
    tx.set(
      ref,
      { [field]: folder.id, [`${field.replace(/Id$/, '')}Url`]: folder.webViewLink ?? null },
      { merge: true },
    );
    return folder.id;
  });
  if (kept !== folder.id) await drive<null>(conn, `/drive/v3/files/${folder.id}`, { method: 'DELETE' }).catch(() => undefined);
  return kept;
}

/** "Manatee Fun Trip Photos/2026-10-17 10:30 AM Mid-morning", made on first use. */
async function tripFolder(conn: Connection, tripId: string, folderName: string): Promise<string> {
  const root = await ensureFolder(conn, 'driveConfig/tripPhotos', 'rootFolderId', ROOT_FOLDER_NAME);
  return ensureFolder(conn, `tripPhotos/${tripId}`, 'folderId', folderName, root);
}

/**
 * Streams one file into the trip's Drive folder with a resumable upload
 * (GoPro videos can be gigabytes). Returns the Drive file id.
 */
export async function copyToDrive(opts: {
  tripId: string;
  folderName: string;
  name: string;
  mimeType: string;
  size: number;
  open: () => NodeJS.ReadableStream;
}): Promise<string | null> {
  const conn = await driveConnection();
  if (!conn) return null;
  const parent = await tripFolder(conn, opts.tripId, opts.folderName);

  const start = await fetch(`${origins().api}/upload/drive/v3/files?uploadType=resumable&fields=id`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${await accessToken(conn)}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': opts.mimeType,
      'X-Upload-Content-Length': String(opts.size),
    },
    body: JSON.stringify({ name: opts.name, parents: [parent] }),
  });
  const session = start.headers.get('location');
  if (!start.ok || !session) {
    const text = await start.text().catch(() => '');
    throw new DriveError(`Starting the Drive upload failed (${start.status}): ${text.slice(0, 300)}`, start.status);
  }

  const put = await fetch(session, {
    method: 'PUT',
    headers: { 'Content-Type': opts.mimeType, 'Content-Length': String(opts.size) },
    body: Readable.toWeb(Readable.from(opts.open())) as ReadableStream,
    // Node's fetch needs this to send a streamed body.
    duplex: 'half',
  } as RequestInit);
  const body = (await put.json().catch(() => ({}))) as { id?: string };
  if (!put.ok || !body.id) {
    throw new DriveError(`Drive upload failed (${put.status})`, put.status);
  }
  logger.info('Copied trip photo to Drive', { tripId: opts.tripId, name: opts.name, driveFileId: body.id });
  return body.id;
}

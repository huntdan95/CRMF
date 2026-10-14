import 'server-only';

/*
 * Minimal Google Drive client for trip photos, over plain fetch.
 *
 * The site acts as one Google account (whoever ran
 * `npm run connect:drive`, normally Travis) with the `drive.file` scope: it
 * can only see and change files it created itself — the trip-photo folders
 * and what goes in them — never the rest of that Drive.
 *
 * Needs three App Hosting env vars (see apphosting.yaml):
 *   GOOGLE_DRIVE_CLIENT_ID, GOOGLE_DRIVE_CLIENT_SECRET, GOOGLE_DRIVE_REFRESH_TOKEN
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

async function drive<T>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${await accessToken()}`,
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

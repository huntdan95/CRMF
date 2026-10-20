import 'server-only';
import { createSign } from 'node:crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { adminDb } from './firebase/admin';

/*
 * Minimal Google Drive client, over plain fetch. It reaches Drive as one of
 * two identities:
 *
 *  - `siteAccount`: one Google account (normally Travis's) with the
 *    `drive.file` scope. It can only see and change files the site created
 *    itself — the trip-photo folders and what goes in them — never the rest
 *    of that Drive. The connection lives in `driveConfig/oauth`
 *    (server-only), where the Cloud Functions that copy trip photos into
 *    Drive read it too (functions/src/lib/google-drive.ts). It comes from
 *    one of two places:
 *      - `npm run connect:drive`, stored as three App Hosting env vars
 *        (see apphosting.yaml): GOOGLE_DRIVE_CLIENT_ID,
 *        GOOGLE_DRIVE_CLIENT_SECRET, GOOGLE_DRIVE_REFRESH_TOKEN.
 *        {@link ensureDriveConnectionDoc} copies them into driveConfig/oauth
 *        the first time it's needed.
 *      - The "Connect Google Drive" button in Admin → Settings
 *        ({@link completeDriveConnection}). That needs a "Web application"
 *        OAuth client with the site's callback URL listed; the desktop
 *        client `connect:drive` uses can't do it.
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

interface Connection {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

const CONNECTION_DOC = 'driveConfig/oauth';

/** Set once driveConfig/oauth is known to exist, so it's read once per server. */
let connectionDocChecked = false;

/**
 * Copies the `npm run connect:drive` env vars into driveConfig/oauth when
 * there's no connection doc at all, so the photo-copying functions use the
 * same Drive as the blog without Travis doing anything. A doc left by
 * "Disconnect" in Settings stays disconnected.
 */
export async function ensureDriveConnectionDoc(): Promise<void> {
  if (connectionDocChecked || !isDriveConfigured()) return;
  const ref = adminDb().doc(CONNECTION_DOC);
  await adminDb().runTransaction(async (tx) => {
    if ((await tx.get(ref)).exists) return;
    tx.set(ref, {
      clientId: process.env.GOOGLE_DRIVE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_DRIVE_CLIENT_SECRET,
      refreshToken: process.env.GOOGLE_DRIVE_REFRESH_TOKEN,
      accountEmail: null,
      connectedAt: FieldValue.serverTimestamp(),
      connectedBy: 'npm run connect:drive',
      lastError: null,
    });
  });
  connectionDocChecked = true;
}

/** The connection to use: driveConfig/oauth, else the env vars. */
async function connection(): Promise<Connection | null> {
  await ensureDriveConnectionDoc().catch((err) => console.error('Drive connection doc sync failed:', err));
  const data = (await adminDb().doc(CONNECTION_DOC).get()).data();
  if (data) {
    return data.refreshToken && data.clientId && data.clientSecret
      ? { clientId: data.clientId, clientSecret: data.clientSecret, refreshToken: data.refreshToken }
      : null;
  }
  return isDriveConfigured()
    ? {
        clientId: process.env.GOOGLE_DRIVE_CLIENT_ID!,
        clientSecret: process.env.GOOGLE_DRIVE_CLIENT_SECRET!,
        refreshToken: process.env.GOOGLE_DRIVE_REFRESH_TOKEN!,
      }
    : null;
}

let cachedToken: { refreshToken: string; value: string; expiresAt: number } | null = null;

async function accessToken(): Promise<string> {
  const conn = await connection();
  if (!conn) throw new DriveError('Google Drive isn’t connected', 401);
  if (cachedToken && cachedToken.refreshToken === conn.refreshToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.value;
  }
  const res = await fetch(TOKEN_URL, {
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
    // `invalid_grant` = the Google account revoked access or the token
    // expired; connect again to get a new one.
    throw new DriveError(`Google token refresh failed: ${body.error ?? res.status}`, res.status);
  }
  cachedToken = {
    refreshToken: conn.refreshToken,
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

// ---------------------------------------------------------------------------
// Connecting from Admin → Settings
// ---------------------------------------------------------------------------

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const ABOUT_URL = 'https://www.googleapis.com/drive/v3/about?fields=user(emailAddress,displayName)';

export function driveOAuthClient(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET;
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

/** Google's consent page, coming back to `redirectUri` with `state`. */
export function driveConsentUrl(redirectUri: string, state: string): string | null {
  const client = driveOAuthClient();
  if (!client) return null;
  return `${AUTH_URL}?${new URLSearchParams({
    client_id: client.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: DRIVE_SCOPE,
    // A refresh token, every time (Google only sends one with consent).
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'false',
    state,
  })}`;
}

/**
 * Swaps Google's code for a refresh token and stores the connection.
 * Returns the connected account's email when Drive will say it.
 */
export async function completeDriveConnection(opts: {
  code: string;
  redirectUri: string;
  connectedBy: string;
}): Promise<{ accountEmail: string | null }> {
  const client = driveOAuthClient();
  if (!client) throw new Error('Google Drive isn’t set up on the server (GOOGLE_DRIVE_CLIENT_ID / _SECRET).');

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: opts.code,
      redirect_uri: opts.redirectUri,
      client_id: client.clientId,
      client_secret: client.clientSecret,
    }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    refresh_token?: string;
    access_token?: string;
    scope?: string;
    error?: string;
  };
  if (!res.ok || !body.refresh_token) {
    throw new Error(`Google didn’t give the site access (${body.error ?? res.status}).`);
  }
  if (!body.scope?.split(' ').includes(DRIVE_SCOPE)) {
    throw new Error('Drive access wasn’t allowed. Try again and tick the Drive box.');
  }

  let accountEmail: string | null = null;
  if (body.access_token) {
    const about = await fetch(ABOUT_URL, { headers: { Authorization: `Bearer ${body.access_token}` } });
    const json = (await about.json().catch(() => ({}))) as { user?: { emailAddress?: string } };
    accountEmail = json.user?.emailAddress ?? null;
  }

  connectionDocChecked = true;
  await adminDb().doc(CONNECTION_DOC).set({
    clientId: client.clientId,
    clientSecret: client.clientSecret,
    refreshToken: body.refresh_token,
    accountEmail,
    connectedAt: FieldValue.serverTimestamp(),
    connectedBy: opts.connectedBy,
    lastError: null,
  });
  return { accountEmail };
}

export interface DriveStatus {
  /** The server has the OAuth client env vars, so connecting can work. */
  configured: boolean;
  connected: boolean;
  accountEmail: string | null;
  connectedAt: string | null;
  /** Set when copying last failed to sign in (Travis removed access, say). */
  lastError: string | null;
  /** The trip-photos root folder in Drive, once it exists. */
  folderUrl: string | null;
}

export async function driveStatus(): Promise<DriveStatus> {
  await ensureDriveConnectionDoc().catch((err) => console.error('Drive connection doc sync failed:', err));
  const db = adminDb();
  const [conn, folder] = await Promise.all([db.doc(CONNECTION_DOC).get(), db.doc('driveConfig/tripPhotos').get()]);
  const c = conn.data();
  return {
    configured: !!driveOAuthClient(),
    connected: !!c?.refreshToken,
    accountEmail: (c?.accountEmail as string | undefined) ?? null,
    connectedAt: (c?.connectedAt as Timestamp | undefined)?.toDate().toISOString() ?? null,
    lastError: (c?.lastError as string | undefined) ?? null,
    folderUrl:
      (folder.get('rootFolderUrl') as string | undefined) ??
      (folder.get('rootFolderId') ? `https://drive.google.com/drive/folders/${folder.get('rootFolderId')}` : null),
  };
}

/**
 * Revokes the site's access at Google and forgets the connection. The doc
 * stays (empty) so {@link ensureDriveConnectionDoc} doesn't bring the
 * revoked env token back.
 */
export async function disconnectDrive(by: string): Promise<void> {
  const ref = adminDb().doc(CONNECTION_DOC);
  const token = (await ref.get()).get('refreshToken') as string | undefined;
  if (token) {
    await fetch(REVOKE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }),
    }).catch(() => undefined);
  }
  cachedToken = null;
  await ref.set({ disconnectedAt: FieldValue.serverTimestamp(), disconnectedBy: by });
}

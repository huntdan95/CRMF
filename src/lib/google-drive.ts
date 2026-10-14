import 'server-only';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { adminDb } from './firebase/admin';

/*
 * Travis connects his Google Drive once, in Admin → Settings, so trip
 * photos are copied into "CRMF Trips" for Grok Bot. Google OAuth with only
 * the `drive.file` scope: the site can see and change only what it
 * creates there, never the rest of his Drive. His Drive is a personal
 * account, so it's his own consent (no service account).
 *
 * The OAuth client id and secret are App Hosting env vars. After he
 * consents, they're stored with his refresh token in `driveConfig/oauth`
 * (server-only in firestore.rules), where the Cloud Functions that copy
 * the photos read them (functions/src/lib/google-drive.ts).
 *
 * The consent screen must be published to Production in Google Cloud: in
 * Testing, Google expires refresh tokens after 7 days.
 */

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const ABOUT_URL = 'https://www.googleapis.com/drive/v3/about?fields=user(emailAddress,displayName)';
const CONNECTION_DOC = 'driveConfig/oauth';

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
  /** The "CRMF Trips" folder, once the first photo has been copied. */
  folderUrl: string | null;
}

export async function driveStatus(): Promise<DriveStatus> {
  const db = adminDb();
  const [conn, folder] = await Promise.all([db.doc(CONNECTION_DOC).get(), db.doc('driveConfig/tripPhotos').get()]);
  const c = conn.data();
  return {
    configured: !!driveOAuthClient(),
    connected: !!c?.refreshToken,
    accountEmail: (c?.accountEmail as string | undefined) ?? null,
    connectedAt: (c?.connectedAt as Timestamp | undefined)?.toDate().toISOString() ?? null,
    lastError: (c?.lastError as string | undefined) ?? null,
    folderUrl: (folder.get('rootFolderUrl') as string | undefined) ?? null,
  };
}

/** Revokes the site's access at Google and forgets the connection. */
export async function disconnectDrive(): Promise<void> {
  const ref = adminDb().doc(CONNECTION_DOC);
  const token = (await ref.get()).get('refreshToken') as string | undefined;
  if (token) {
    await fetch(REVOKE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }),
    }).catch(() => undefined);
  }
  await ref.delete();
}

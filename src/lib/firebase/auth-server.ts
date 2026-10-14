import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { adminAuth } from './admin';

export const ADMIN_SESSION_COOKIE = 'crmf_admin_session';
export const ADMIN_SESSION_MAX_AGE_S = 60 * 60 * 24 * 5; // 5 days

export interface AdminUser {
  uid: string;
  email: string;
  name: string | null;
  picture: string | null;
}

/** Travis's address. Wrong-account messages point to it. */
export function configuredAdminEmail(): string | null {
  return process.env.NEXT_PUBLIC_ADMIN_EMAIL?.toLowerCase().trim() || null;
}

/**
 * True for an address allowed into admin: Travis's, or one listed in
 * OTHER_ADMIN_EMAILS (comma-separated). Keep that list in step with the
 * Cloud Functions param of the same name and `isAdmin()` in firestore.rules
 * and storage.rules.
 */
export function isAdminEmail(email: string | undefined): boolean {
  if (!email) return false;
  const others = (process.env.OTHER_ADMIN_EMAILS ?? '').split(',');
  return [configuredAdminEmail(), ...others]
    .map((e) => e?.toLowerCase().trim())
    .some((e) => e && e === email.toLowerCase());
}

/**
 * Reads the session cookie set at admin login time and verifies it with
 * Firebase Admin SDK. Returns `null` on any failure (no cookie, expired,
 * revoked, wrong email) — callers decide whether to redirect.
 *
 * Use {@link requireAdmin} in pages that must be authenticated.
 */
export async function getAdminUser(): Promise<AdminUser | null> {
  if (!configuredAdminEmail()) {
    // Without an allowlist we cannot safely authenticate anyone.
    console.warn('NEXT_PUBLIC_ADMIN_EMAIL not configured — admin routes are inaccessible.');
    return null;
  }

  const store = await cookies();
  const session = store.get(ADMIN_SESSION_COOKIE)?.value;
  if (!session) return null;

  try {
    const decoded = await adminAuth().verifySessionCookie(session, true);
    if (!isAdminEmail(decoded.email)) return null;
    if (!decoded.email_verified) return null;
    return {
      uid: decoded.uid,
      email: decoded.email!,
      name: (decoded.name as string | undefined) ?? null,
      picture: (decoded.picture as string | undefined) ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * Server-side guard for admin pages. Redirects to `/admin/login` with a
 * `next=` query param when the user isn't authenticated.
 */
export async function requireAdmin(currentPath?: string): Promise<AdminUser> {
  const user = await getAdminUser();
  if (!user) {
    const params = currentPath ? `?next=${encodeURIComponent(currentPath)}` : '';
    redirect(`/admin/login${params}`);
  }
  return user;
}

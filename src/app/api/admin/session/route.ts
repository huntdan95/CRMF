import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { adminAuth } from '@/lib/firebase/admin';
import {
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_MAX_AGE_S,
} from '@/lib/firebase/auth-server';

export const runtime = 'nodejs';

function adminEmail(): string | null {
  return process.env.NEXT_PUBLIC_ADMIN_EMAIL?.toLowerCase().trim() || null;
}

/** Enough of the admin address to recognise it ("t•••1@gmail.com") without printing it in full. */
function maskEmail(email: string): string {
  const [name, domain] = email.split('@');
  if (!name || !domain) return 'the admin Google account';
  return `${name[0]}•••${name.length > 2 ? name.at(-1) : ''}@${domain}`;
}

/**
 * POST /api/admin/session
 *
 * Body: { idToken: string }
 *
 * Exchanges a freshly-issued Firebase ID token (from Google sign-in on the
 * client) for an httpOnly session cookie. Verifies that the signing-in user
 * matches the configured admin email.
 */
export async function POST(req: NextRequest) {
  const expected = adminEmail();
  if (!expected) {
    return NextResponse.json(
      { error: 'Admin email not configured on the server.' },
      { status: 500 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = z
    .object({ idToken: z.string().min(10) })
    .safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'idToken required' }, { status: 400 });
  }

  let decoded;
  try {
    decoded = await adminAuth().verifyIdToken(parsed.data.idToken, true);
  } catch {
    return NextResponse.json({ error: 'Invalid ID token' }, { status: 401 });
  }

  if ((decoded.email ?? '').toLowerCase() !== expected) {
    return NextResponse.json(
      {
        error: `You signed in as ${decoded.email ?? 'a Google account'}, which doesn’t have admin access. Tap “Continue with Google” again and choose ${maskEmail(expected)}.`,
      },
      { status: 403 },
    );
  }
  if (!decoded.email_verified) {
    return NextResponse.json(
      { error: 'Email is not verified by the identity provider.' },
      { status: 403 },
    );
  }

  // Issue a session cookie (Firebase Admin SDK manages signing + expiry).
  const expiresMs = ADMIN_SESSION_MAX_AGE_S * 1000;
  const session = await adminAuth().createSessionCookie(parsed.data.idToken, {
    expiresIn: expiresMs,
  });

  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_SESSION_COOKIE, session, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: ADMIN_SESSION_MAX_AGE_S,
    path: '/',
  });
  return res;
}

/**
 * DELETE /api/admin/session
 *
 * Clears the cookie. Doesn't revoke the underlying Firebase Auth session —
 * to do that, the client should also call `signOut()` on the Firebase SDK.
 */
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_SESSION_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 0,
    path: '/',
  });
  return res;
}

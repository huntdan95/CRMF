import { NextResponse } from 'next/server';
import { adminAuth } from '@/lib/firebase/admin';
import { getAdminUser } from '@/lib/firebase/auth-server';

export const runtime = 'nodejs';

/**
 * POST /api/admin/session/firebase
 *
 * Returns `{ token }`: a Firebase custom token for the admin whose session
 * cookie came with the request, so the browser can sign Firebase Auth back
 * in (`ensureAdminFirebaseUser()` in src/lib/firebase/auth-client.ts).
 *
 * Admin pages load on the session cookie, but Firestore reads and admin
 * Cloud Function calls need Firebase Auth signed in on the device too. The
 * two can come apart: an iPhone copies Safari's cookies, and not its
 * Firebase sign-in, into the Home Screen app, which then opens on a
 * calendar that can't load. A 503 means this server can't sign tokens (its
 * service account needs Service Account Token Creator); the browser then
 * sends Travis to sign in with Google once more instead.
 */
export async function POST() {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: 'Signed out' }, { status: 401 });

  try {
    const token = await adminAuth().createCustomToken(admin.uid);
    return NextResponse.json({ token }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('Could not make a Firebase custom token for the admin', err);
    return NextResponse.json({ error: 'Could not restore the sign-in' }, { status: 503 });
  }
}

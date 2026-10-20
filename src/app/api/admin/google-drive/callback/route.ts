import { timingSafeEqual } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { getAdminUser } from '@/lib/firebase/auth-server';
import { completeDriveConnection } from '@/lib/google-drive';
import { STATE_COOKIE, callbackUrl } from '../oauth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function sameState(a: string | undefined, b: string | null): boolean {
  if (!a || !b || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * GET /api/admin/google-drive/callback?code=…&state=…
 *
 * Google sends Travis back here after he allows (or refuses) Drive access.
 * Stores the connection and returns him to Settings with the outcome.
 */
export async function GET(req: NextRequest) {
  const settings = new URL('/admin/settings', req.nextUrl);
  const done = (outcome: string) => {
    settings.searchParams.set('drive', outcome);
    const res = NextResponse.redirect(settings);
    res.cookies.delete({ name: STATE_COOKIE, path: '/api/admin/google-drive' });
    return res;
  };

  const user = await getAdminUser();
  if (!user) return NextResponse.redirect(new URL('/admin/login?next=/admin/settings', req.nextUrl));
  if (!sameState(req.cookies.get(STATE_COOKIE)?.value, req.nextUrl.searchParams.get('state'))) {
    return done('expired');
  }
  if (req.nextUrl.searchParams.get('error')) return done('refused');
  const code = req.nextUrl.searchParams.get('code');
  if (!code) return done('error');

  try {
    await completeDriveConnection({ code, redirectUri: callbackUrl(req), connectedBy: user.email });
    return done('connected');
  } catch (err) {
    console.error('Google Drive connection failed:', err);
    return done('error');
  }
}

import { randomBytes } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { getAdminUser } from '@/lib/firebase/auth-server';
import { driveConsentUrl } from '@/lib/google-drive';
import { STATE_COOKIE, callbackUrl } from '../oauth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/google-drive/connect
 *
 * The "Connect Google Drive" button in Admin → Settings. Sends Travis to
 * Google's consent page for the drive.file scope.
 */
export async function GET(req: NextRequest) {
  const settings = new URL('/admin/settings', req.nextUrl);
  if (!(await getAdminUser())) {
    return NextResponse.redirect(new URL('/admin/login?next=/admin/settings', req.nextUrl));
  }
  const state = randomBytes(24).toString('base64url');
  const url = driveConsentUrl(callbackUrl(req), state);
  if (!url) {
    settings.searchParams.set('drive', 'not-configured');
    return NextResponse.redirect(settings);
  }
  const res = NextResponse.redirect(url);
  res.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: req.nextUrl.protocol === 'https:',
    sameSite: 'lax',
    path: '/api/admin/google-drive',
    maxAge: 10 * 60,
  });
  return res;
}

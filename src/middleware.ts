import { NextResponse, type NextRequest } from 'next/server';
import { ADMIN_SESSION_COOKIE } from '@/lib/firebase/auth-server';

/**
 * Edge-only presence check for the admin session cookie.
 *
 * We don't run Firebase Admin SDK here (it requires Node APIs). The cookie
 * is fully verified inside the (admin) layout via `requireAdmin()` — this
 * middleware just avoids loading the heavy admin client when there's
 * obviously no session.
 */
export function middleware(req: NextRequest) {
  const cookie = req.cookies.get(ADMIN_SESSION_COOKIE)?.value;
  if (cookie) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = '/admin/login';
  url.searchParams.set('next', req.nextUrl.pathname);
  return NextResponse.redirect(url);
}

export const config = {
  // Apply to every admin route EXCEPT /admin/login itself.
  matcher: ['/admin/((?!login).*)', '/admin'],
};

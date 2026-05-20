import { NextResponse, type NextRequest } from 'next/server';
import { ADMIN_SESSION_COOKIE } from '@/lib/firebase/auth-server';

/**
 * Edge proxy (formerly `middleware` in Next ≤ 15) — runs before every
 * matching request. We use it to short-circuit `/admin/*` requests that
 * arrive without a session cookie.
 *
 * Firebase Admin SDK can't run at the edge (Node-only APIs), so the real
 * session verification still happens in the (protected) layout via
 * `requireAdmin()`. This check is the cheap first pass.
 */
export function proxy(req: NextRequest) {
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

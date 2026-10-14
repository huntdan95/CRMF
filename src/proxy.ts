import { NextResponse, type NextRequest } from 'next/server';
import { ADMIN_SESSION_COOKIE } from '@/lib/firebase/auth-server';
import { PRODUCTION_HOST, hostFromHeaders } from '@/lib/host';
import { siteConfig } from '@/lib/site-config';

/**
 * Proxy (formerly `middleware` in Next ≤ 15) — runs before every matching
 * request. It does three things:
 *
 * 1. When CANONICAL_HOST_REDIRECT=true, 301s `www.` and the `*.hosted.app`
 *    staging URL to the apex domain, keeping the path and query.
 * 2. Short-circuits `/admin/*` requests that arrive without a session
 *    cookie. Firebase Admin SDK can't run here, so the real session
 *    verification still happens in the (protected) layout via
 *    `requireAdmin()`. This check is the cheap first pass.
 * 3. Marks every response on a non-production host `noindex`, so the
 *    staging URL can't compete with the real domain in Google.
 */
export function proxy(req: NextRequest) {
  const host = hostFromHeaders(req.headers);

  if (
    process.env.CANONICAL_HOST_REDIRECT === 'true' &&
    redirectsToApex(host) &&
    !exemptFromHostRedirect(req)
  ) {
    const { pathname, search } = req.nextUrl;
    return NextResponse.redirect(`${siteConfig.url}${pathname}${search}`, 301);
  }

  const res = needsAdminSession(req)
    ? redirectToAdminLogin(req)
    : NextResponse.next();

  if (host !== PRODUCTION_HOST) {
    res.headers.set('X-Robots-Tag', 'noindex, nofollow');
  }
  return res;
}

function redirectsToApex(host: string): boolean {
  return host === `www.${PRODUCTION_HOST}` || host.endsWith('.hosted.app');
}

/**
 * Left on the current host:
 *  - `/api/*` (the admin session cookie endpoint)
 *  - `/admin/*` — the session cookie is per-host, so redirecting would
 *    sign Travis out mid-session
 *  - `/crew`, `/crew/*` and the crew service worker — same reason, for the
 *    crew's home-screen app (a service worker script can't be redirected)
 *  - `/__/*` — Firebase's sign-in helper pages, which must stay on the
 *    host the sign-in started on
 *  - anything that isn't GET/HEAD — a 301 would turn a form POST into a GET
 * The booking flow itself talks to Cloud Functions directly (CORS allows
 * the apex), and Stripe's return URL keeps its query string through the
 * redirect, so it needs no exemption.
 */
function exemptFromHostRedirect(req: NextRequest): boolean {
  if (req.method !== 'GET' && req.method !== 'HEAD') return true;
  const { pathname } = req.nextUrl;
  return (
    pathname.startsWith('/api/') ||
    pathname === '/admin' ||
    pathname.startsWith('/admin/') ||
    pathname === '/crew' ||
    pathname.startsWith('/crew/') ||
    pathname === '/crew-sw.js' ||
    pathname.startsWith('/__/')
  );
}

/** Every admin route except /admin/login itself. */
function needsAdminSession(req: NextRequest): boolean {
  const { pathname } = req.nextUrl;
  const isAdmin =
    pathname === '/admin' ||
    (pathname.startsWith('/admin/') && !pathname.startsWith('/admin/login'));
  return isAdmin && !req.cookies.get(ADMIN_SESSION_COOKIE)?.value;
}

function redirectToAdminLogin(req: NextRequest) {
  const url = req.nextUrl.clone();
  url.pathname = '/admin/login';
  url.searchParams.set('next', req.nextUrl.pathname);
  return NextResponse.redirect(url);
}

export const config = {
  // Every page and route handler. Static assets, image optimization, and
  // the icon/manifest routes don't need the noindex header or a redirect.
  matcher: [
    '/((?!_next/static|_next/image|favicon\\.ico|icon|apple-icon|manifest\\.webmanifest).*)',
  ],
};

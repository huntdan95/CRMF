import { firebaseConfig, getFirebaseApp } from './app';

/**
 * Pages whose URL holds a booking's access token (`?t=`, which can read
 * and cancel the booking), a waiver signing key (`?k=`), a Stripe session
 * id, or a crew photo-upload token (`/upload/<token>`, which lets anyone
 * add files to that trip's gallery). Analytics reports the full page URL,
 * so it never starts on these: the token would sit in the Analytics
 * property for anyone with access to read.
 */
function carriesSecret(loc: Location): boolean {
  const params = new URLSearchParams(loc.search);
  return (
    params.has('t') ||
    params.has('k') ||
    params.has('session_id') ||
    loc.pathname.startsWith('/my-booking') ||
    loc.pathname.startsWith('/book/confirmation') ||
    // Signing pages, not the /waiver page itself.
    loc.pathname.startsWith('/waiver/') ||
    loc.pathname.startsWith('/upload/')
  );
}

/**
 * Browser-only Firebase Analytics init. Returns `null` on the server, in
 * unsupported browsers, when `measurementId` isn't configured, or on a
 * page whose URL carries a booking token.
 */
export async function initAnalyticsIfSupported() {
  if (typeof window === 'undefined') return null;
  if (!firebaseConfig.measurementId) return null;
  if (carriesSecret(window.location)) return null;
  const { getAnalytics, isSupported } = await import('firebase/analytics');
  if (!(await isSupported())) return null;
  return getAnalytics(getFirebaseApp());
}

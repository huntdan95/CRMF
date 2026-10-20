'use client';

import { useEffect } from 'react';
import { ensureAdminFirebaseUser } from '@/lib/firebase/auth-client';

/**
 * Admin pages open on the server's session cookie, but read and save with
 * this browser's own Firebase sign-in. The two can come apart: Safari can
 * copy a site's cookies, and none of its other storage, into an app added
 * from it to the home screen or Dock, so that app opens signed in with no
 * Firebase sign-in and every page fails to load. Signs this device back in
 * from the session cookie or, failing that, sends it to sign in again,
 * coming back to the same page (`ensureAdminFirebaseUser()`).
 *
 * Checks once per visit: the sidebar's Sign out clears the Firebase sign-in
 * on purpose and goes to the sign-in page itself.
 */
export function AdminSignInCheck() {
  useEffect(() => {
    // A failure shows where the page's own reads fail.
    ensureAdminFirebaseUser().catch(() => undefined);
  }, []);
  return null;
}

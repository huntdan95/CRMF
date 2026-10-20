'use client';

import { useEffect } from 'react';
import { getFirebaseAuth } from '@/lib/firebase/client';

/**
 * Admin pages open on the server's session cookie, but read and save with
 * this browser's own Firebase sign-in. The two can come apart: Safari can
 * copy a site's cookies, and none of its other storage, into an app added
 * from it to the home screen or Dock, so that app opens signed in with no
 * Firebase sign-in and every page fails to load. Sends this device to sign
 * in again, coming back to the same page.
 *
 * Checks once per visit: the sidebar's Sign out clears the Firebase sign-in
 * on purpose and goes to the sign-in page itself.
 */
export function AdminSignInCheck() {
  useEffect(() => {
    let live = true;
    (async () => {
      const auth = getFirebaseAuth();
      await auth.authStateReady();
      if (!live || auth.currentUser) return;
      const here = window.location.pathname + window.location.search;
      window.location.replace(`/admin/login?next=${encodeURIComponent(here)}&reason=device`);
    })().catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  return null;
}

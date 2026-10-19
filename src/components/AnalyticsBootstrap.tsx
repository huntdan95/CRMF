'use client';

import { useEffect } from 'react';

/**
 * Browser-only initializer for Firebase Analytics. Mounted once from the
 * root layout. Safely no-ops when `measurementId` isn't configured or the
 * browser doesn't support Analytics (e.g. cookie-blocked environments).
 *
 * The Firebase code loads after the page is up, not with it: every page
 * mounts this, and Analytics is the only Firebase most of them use.
 */
export function AnalyticsBootstrap() {
  useEffect(() => {
    import('@/lib/firebase/analytics')
      .then(({ initAnalyticsIfSupported }) => initAnalyticsIfSupported())
      .catch(() => {
        // Analytics is best-effort — ad blockers and privacy modes will
        // routinely reject it. Don't surface the error to the user.
      });
  }, []);
  return null;
}

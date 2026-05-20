'use client';

import { useEffect } from 'react';
import { initAnalyticsIfSupported } from '@/lib/firebase/client';

/**
 * Browser-only initializer for Firebase Analytics. Mounted once from the
 * root layout. Safely no-ops when `measurementId` isn't configured or the
 * browser doesn't support Analytics (e.g. cookie-blocked environments).
 */
export function AnalyticsBootstrap() {
  useEffect(() => {
    initAnalyticsIfSupported().catch(() => {
      // Analytics is best-effort — ad blockers and privacy modes will
      // routinely reject it. Don't surface the error to the user.
    });
  }, []);
  return null;
}

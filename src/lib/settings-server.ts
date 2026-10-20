import 'server-only';
import { adminDb } from './firebase/admin';
import type { WetsuitSizes } from './site-settings';

export interface SiteSettings {
  cancellationPolicyText?: string;
  contactEmail?: string;
  /** Minutes Travis can undo closing a day before anything goes out. 0: no wait. */
  closureUndoMinutes?: number;
  /** The Google review link in the thank-you email. Default: DEFAULT_GOOGLE_REVIEW_URL. */
  googleReviewUrl?: string;
  /** Sizes guests pick from at booking. Read with wetsuitSizesFrom(). */
  wetsuitSizes?: WetsuitSizes;
  updatedAt?: { seconds: number; nanoseconds: number };
  updatedBy?: string;
}

/**
 * Reads `settings/site` from Firestore. Returns `null` on any failure
 * (no doc yet, Firestore unreachable, etc.) so callers can fall back to
 * defaults without a try/catch.
 */
export async function fetchSiteSettings(): Promise<SiteSettings | null> {
  try {
    const snap = await adminDb().collection('settings').doc('site').get();
    if (!snap.exists) return null;
    return snap.data() as SiteSettings;
  } catch {
    return null;
  }
}

export { DEFAULT_CANCELLATION_POLICY } from './cancellation-policy';

import 'server-only';
import { adminDb } from './firebase/admin';

export interface SiteSettings {
  cancellationPolicyText?: string;
  contactEmail?: string;
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

export const DEFAULT_CANCELLATION_POLICY = [
  'More than 72 hours before your tour: full refund.',
  '24-72 hours before your tour: 50% refund.',
  'Less than 24 hours before your tour: no refund (call Travis for emergencies — he works with people who get sick or have family situations).',
  'Travis-cancelled tours (weather, mechanical, etc.): always full refund. Always.',
].join('\n');

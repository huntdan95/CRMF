/**
 * When the Terms of Service and Privacy Policy last changed (YYYY-MM-DD).
 * Each page shows its date as "Last updated", and checkout saves
 * TERMS_VERSION on the booking so we can tell which terms a guest agreed
 * to. Change the date whenever that page's wording changes.
 */
export const TERMS_VERSION = '2026-10-14';
export const PRIVACY_VERSION = '2026-10-14';

/** `2026-10-14` → `October 14, 2026`. */
export function formatLegalDate(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

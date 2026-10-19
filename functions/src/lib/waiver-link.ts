import { createHash } from 'node:crypto';

/**
 * The shareable waiver signing link for a booking. The key MUST match
 * `waiverKey` in the Next app (src/lib/waiver/server.ts): derived from the
 * accessToken, so a forwarded signing link can't be used to cancel the
 * booking.
 */
export function waiverKey(accessToken: string): string {
  return createHash('sha256').update(`waiver-link:${accessToken}`).digest('base64url').slice(0, 32);
}

export function waiverUrl(baseUrl: string, bookingId: string, accessToken: string): string {
  return `${baseUrl}/waiver/${bookingId}?k=${waiverKey(accessToken)}`;
}

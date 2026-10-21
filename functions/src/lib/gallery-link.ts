import { createHash } from 'node:crypto';

/**
 * The photos email's gallery link. The key MUST match `galleryKey` in the
 * Next app (src/lib/gallery-link.ts): derived from the accessToken, so a
 * link the booker forwards to their party (or a family group chat) opens
 * the photos and nothing else. It can't be turned back into the token, so
 * it doesn't open their booking page or the private-feedback form, and a
 * new token ("Reset their booking links") cuts it off too.
 */
export function galleryKey(accessToken: string): string {
  return createHash('sha256').update(`gallery-link:${accessToken}`).digest('base64url').slice(0, 32);
}

export function galleryLink(baseUrl: string, bookingId: string, accessToken: string): string {
  return `${baseUrl}/my-booking/${bookingId}/photos?k=${galleryKey(accessToken)}`;
}

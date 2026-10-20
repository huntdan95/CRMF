import { createHash } from 'node:crypto';

/**
 * The key in the photos email's gallery link, /my-booking/<id>/photos?k=.
 * MUST match `galleryKey` in functions/src/lib/gallery-link.ts:
 * base64url(SHA-256("gallery-link:" + accessToken)), first 32 characters.
 * It opens the gallery and nothing else, so the booker can forward it.
 */
export function galleryKey(accessToken: string): string {
  return createHash('sha256').update(`gallery-link:${accessToken}`).digest('base64url').slice(0, 32);
}

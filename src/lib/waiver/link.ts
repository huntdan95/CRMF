/**
 * Builds a booking's waiver signing link in the browser (admin). The key
 * MUST match `waiverKey` in src/lib/waiver/server.ts and
 * functions/src/lib/waiver-link.ts: base64url(SHA-256("waiver-link:" +
 * accessToken)), first 32 characters.
 */
export async function waiverSigningLink(
  origin: string,
  bookingId: string,
  accessToken: string,
): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`waiver-link:${accessToken}`),
  );
  const b64 = btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `${origin}/waiver/${bookingId}?k=${b64.slice(0, 32)}`;
}

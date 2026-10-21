import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/**
 * The key for POST /api/revalidate, worked out from MCP_TOKEN the way
 * blogKey is (src/lib/mcp/http.ts), so there's no other secret to keep. The
 * admin Cloud Functions work out the same key (revalidateKey in
 * functions/src/lib/site-refresh.ts) to ask the site to refresh its pages
 * after Travis changes what they show. It opens nothing else, and
 * MCP_TOKEN can't be recovered from it.
 */
export function revalidateKey(token: string): string {
  return createHmac('sha256', token).update('crmf-revalidate').digest('base64url');
}

/** Whether `presented` is the revalidate key for `token`, compared in constant time. */
export function isRevalidateKey(presented: string, token: string): boolean {
  // Hashing both sides first gives timingSafeEqual equal lengths, so a
  // wrong guess's length isn't given away either.
  const digest = (v: string) => createHash('sha256').update(v).digest();
  return timingSafeEqual(digest(presented), digest(revalidateKey(token)));
}

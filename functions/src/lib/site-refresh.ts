import { createHmac } from 'node:crypto';
import { APP_BASE_URL, MCP_TOKEN } from './config';

/**
 * The key the site's POST /api/revalidate takes, worked out from MCP_TOKEN
 * so there's no other secret to keep. Same as revalidateKey in
 * src/lib/revalidate-key.ts; test/revalidate-key.test.ts checks they agree.
 */
export function revalidateKey(token: string): string {
  return createHmac('sha256', token).update('crmf-revalidate').digest('base64url');
}

/**
 * How long a save waits on the site. The site is normally awake (Travis's
 * admin pages and the MCP endpoint run on it), so this only bites when it's
 * down or stuck.
 */
const REFRESH_TIMEOUT_MS = 8_000;

/**
 * Asks the site to refresh its pages, after an admin change to something
 * they show (tours, seasonal rates, site photos, reviews, the cancellation
 * policy). Call it after the write and before answering: Cloud Functions
 * can stop running a function once it has answered. Endpoints that call it
 * list APP_BASE_URL and MCP_TOKEN in their `secrets`; listing MCP_TOKEN
 * only lets this work out the key, it doesn't let the token sign in
 * (that's `requireAdmin(req, { allowMcp: true })`).
 *
 * Never throws. The change is already saved, and if this doesn't get
 * through, the pages pick it up on their own within a minute (they refresh
 * every 60 seconds), so a failure is only logged. True when the site said
 * it was done.
 */
export async function refreshSitePages(
  deps: { baseUrl?: string; token?: string; fetch?: typeof fetch } = {},
): Promise<boolean> {
  try {
    const token = deps.token ?? MCP_TOKEN.value();
    const base = (deps.baseUrl ?? APP_BASE_URL.value()).replace(/\/+$/, '');
    if (!token || !base) {
      console.warn('Site refresh skipped: APP_BASE_URL or MCP_TOKEN isn’t set. The pages catch up within a minute.');
      return false;
    }
    const res = await (deps.fetch ?? fetch)(`${base}/api/revalidate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${revalidateKey(token)}` },
      signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error(`Site refresh: /api/revalidate answered ${res.status}. The pages catch up within a minute.`);
      return false;
    }
    return true;
  } catch (err) {
    console.error('Site refresh failed. The pages catch up within a minute.', err);
    return false;
  }
}

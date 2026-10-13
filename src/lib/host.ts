import { siteConfig } from './site-config';

/** `crystalrivermanateefun.com` — the only host search engines should index. */
export const PRODUCTION_HOST = new URL(siteConfig.url).host;

/**
 * The public host a request was made to, lowercased and without a port.
 * Prefers `X-Forwarded-Host` (set by App Hosting's front end) over `Host`.
 */
export function hostFromHeaders(headers: { get(name: string): string | null }): string {
  const raw = headers.get('x-forwarded-host') ?? headers.get('host') ?? '';
  return raw.split(',')[0].trim().toLowerCase().replace(/:\d+$/, '');
}

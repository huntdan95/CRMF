import { siteConfig } from './site-config';

/** `crystalrivermanateefun.com` — the only host search engines should index. */
export const PRODUCTION_HOST = new URL(siteConfig.url).host;

/** `Example.com:443` → `example.com`. */
function normalizeHost(raw: string): string {
  return raw.trim().toLowerCase().replace(/:\d+$/, '');
}

/**
 * The public host a request was made to, lowercased and without a port.
 * Prefers `X-Forwarded-Host` (set by App Hosting's front end) over `Host`.
 */
export function hostFromHeaders(headers: { get(name: string): string | null }): string {
  const raw = headers.get('x-forwarded-host') ?? headers.get('host') ?? '';
  return normalizeHost(raw.split(',')[0]);
}

/**
 * Whether any host the request names is the production domain: `Host`, or
 * any entry of `X-Forwarded-Host`. The noindex header and the staging
 * robots.txt go only to requests that name it nowhere.
 *
 * {@link hostFromHeaders} reads the leftmost `X-Forwarded-Host`, which a
 * visitor can write themselves. Whether App Hosting's front end replaces
 * that header, appends to it or passes it through isn't documented, and the
 * CDN caches pages for everyone with the headers the first request got. So
 * one request to the real domain with a made-up `X-Forwarded-Host` mustn't
 * be able to make a page noindex. A visitor can add a host, but can't take
 * away the real one the front end sets, in `Host` or appended to the list.
 * (If it set neither, a made-up header would still win; the README's
 * post-launch curl check catches that.) The cost is the other way round: a
 * staging request naming the real domain isn't marked noindex, which at
 * worst leaves a cached staging page indexable for a minute, its canonical
 * still pointing at the real domain.
 */
export function namesProductionHost(headers: { get(name: string): string | null }): boolean {
  const named = [headers.get('host') ?? '', ...(headers.get('x-forwarded-host') ?? '').split(',')];
  return named.some((h) => normalizeHost(h) === PRODUCTION_HOST);
}

/**
 * Every URL from the old WordPress site's Yoast sitemaps (captured
 * 2026-10-13) and where it lands on this site. See SEO_MIGRATION.md,
 * Appendix A.
 *
 * Read by `next.config.ts` (to build `redirects()`) and by
 * `scripts/check-redirects.ts` (to verify them against a running server).
 * Keep this file free of `@/` imports — next.config can't resolve them.
 *
 * Actions:
 *  - `keep`     same path on the new site; Next's trailing-slash 308 handles it
 *  - `redirect` needs a rule (generated below)
 *  - `new`      a route that exists on the new site under the same path
 */
export type LegacyAction = 'keep' | 'redirect' | 'new';

export interface LegacyUrl {
  /** Path exactly as on the old site, trailing slash included. */
  from: string;
  /** Destination path on the new site (may carry a #fragment). */
  to: string;
  action: LegacyAction;
  note: string;
}

export const legacyUrls: LegacyUrl[] = [
  { from: '/', to: '/', action: 'keep', note: 'Homepage' },
  { from: '/sample-page/', to: '/', action: 'redirect', note: 'WordPress default page' },
  { from: '/services/', to: '/tours', action: 'redirect', note: 'Thin leftover' },
  { from: '/charters/', to: '/tours', action: 'redirect', note: 'Thin leftover' },
  { from: '/my-account/', to: '/contact', action: 'redirect', note: 'WooCommerce account' },
  { from: '/boat/', to: '/about', action: 'redirect', note: 'Placeholder page; no boat page on new site' },
  { from: '/liability-waiver-example/', to: '/waiver', action: 'redirect', note: 'The waiver to read before booking; guests sign it from their confirmation' },
  { from: '/crystal-river/', to: '/about#area', action: 'redirect', note: 'Owner chose to keep this as a section of /about' },
  { from: '/profile-page/', to: '/contact', action: 'redirect', note: 'Account utility' },
  { from: '/checkout/', to: '/book', action: 'redirect', note: 'Old WooCommerce checkout' },
  { from: '/cart/', to: '/book', action: 'redirect', note: 'Old WooCommerce cart' },
  { from: '/frequently-asked-questions/', to: '/faq', action: 'redirect', note: 'Richest old page; content merged into /faq' },
  { from: '/captain/', to: '/about#captain', action: 'redirect', note: 'Old captain page' },
  { from: '/charter-terms/', to: '/cancellation-policy', action: 'redirect', note: 'Old policy page' },
  { from: '/contact/', to: '/contact', action: 'keep', note: 'Trailing slash only' },
  { from: '/charter-confirmation/', to: '/book', action: 'redirect', note: 'Old booking utility' },
  { from: '/wetsuit-sizing/', to: '/tours', action: 'redirect', note: 'Sizes are collected in the booking form; /tours, not the noindex /book, so the old page keeps its ranking' },
  { from: '/private-manatee-swimming-tours/', to: '/tours#private', action: 'redirect', note: 'Keyword URL → private section of /tours' },
  { from: '/shop/', to: '/tours', action: 'redirect', note: "Old 'Manatee Tours' menu item" },
  { from: '/book-now/', to: '/tours', action: 'redirect', note: "Old main 'Book Now' button; /tours, not the noindex /book, so the old page keeps its ranking" },
  { from: '/news/magnificent-manatee-footage-today/', to: '/news/magnificent-manatee-footage-today', action: 'new', note: 'Migrated post' },
  { from: '/news/incredible-day-snorkling-with-manatees/', to: '/news/incredible-day-snorkling-with-manatees', action: 'new', note: 'Migrated post; typo slug kept on purpose' },
  { from: '/news/an-unforgettable-experience/', to: '/news/an-unforgettable-experience', action: 'new', note: 'Migrated post' },
  { from: '/news/amazing-day-swimming-with-the-manatees/', to: '/news/amazing-day-swimming-with-the-manatees', action: 'new', note: 'Migrated post' },
  { from: '/news/manatee-tours-manatee-habitat/', to: '/news/manatee-tours-manatee-habitat', action: 'new', note: 'Migrated post' },
  { from: '/category/news/', to: '/news', action: 'redirect', note: 'Old blog index' },
  { from: '/product/2hr-sunset-tour-private/', to: '/tours/sunset-private', action: 'redirect', note: 'The private sunset cruise, back April 1 - November 14' },
  { from: '/product/whole-day-tour-private/', to: '/tours/whole-day-private', action: 'redirect', note: 'Whole day private' },
  { from: '/product/2hr-early-tour-private/', to: '/tours/morning-private', action: 'redirect', note: 'Old 8am' },
  { from: '/product/3hr-morning-tour-private/', to: '/tours/morning-private', action: 'redirect', note: 'Old 8am' },
  { from: '/product/2hr-midday-tour-private/', to: '/tours/mid-morning-private', action: 'redirect', note: 'Old midday' },
  { from: '/product/3hr-afternoon-tour-private/', to: '/tours/early-afternoon-private', action: 'redirect', note: 'Old 1pm' },
  { from: '/product/2hr-early-tour-shared/', to: '/tours/morning-shared', action: 'redirect', note: 'Old 8am' },
  { from: '/product/2hr-morning-tour-shared/', to: '/tours/mid-morning-shared', action: 'redirect', note: 'Old 10:30am' },
  { from: '/product/2hr-midday-tour-shared/', to: '/tours/mid-morning-shared', action: 'redirect', note: 'Old 11am' },
  { from: '/product/3hr-afternoon-tour-shared/', to: '/tours/early-afternoon-shared', action: 'redirect', note: 'Old 2pm' },
  { from: '/product/2hr-afternoon-ecotour-private/', to: '/tours/early-afternoon-private', action: 'redirect', note: 'Eco tour retired; owner chose the closest private slot' },
  { from: '/product-category/manatee-tours/', to: '/tours', action: 'redirect', note: 'Product category' },
  { from: '/product-category/eco-tours/', to: '/tours', action: 'redirect', note: 'Product category' },
];

export interface LegacyCatchAll {
  /** Next.js path pattern. */
  source: string;
  destination: string;
  /** A made-up old URL the checker uses to prove the pattern matches. */
  example: string;
}

/**
 * Old WordPress URL shapes that aren't in the sitemap (other products,
 * tag archives, feeds…). These run after the specific rules.
 */
export const legacyCatchAlls: LegacyCatchAll[] = [
  { source: '/product/:slug*', destination: '/tours', example: '/product/some-old-tour/' },
  { source: '/product-category/:slug*', destination: '/tours', example: '/product-category/some-old-category/' },
  { source: '/category/:slug*', destination: '/news', example: '/category/uncategorized/' },
  { source: '/tag/:slug*', destination: '/news', example: '/tag/manatees/' },
  { source: '/author/:slug*', destination: '/about#captain', example: '/author/travis/' },
  { source: '/feed', destination: '/news', example: '/feed/' },
  { source: '/feed/:path+', destination: '/news', example: '/feed/rss2/' },
  { source: '/news/feed', destination: '/news', example: '/news/feed/' },
  // The comment feed WordPress linked from every post's <head>.
  { source: '/news/:slug/feed', destination: '/news', example: '/news/an-unforgettable-experience/feed/' },
  { source: '/comments/feed', destination: '/news', example: '/comments/feed/' },
  { source: '/my-account/:path*', destination: '/contact', example: '/my-account/orders/' },
  // WooCommerce's emailed "Pay for this order" and order-received links.
  // Old-site bookings are settled with Travis, so they land on his contact
  // page; the bare /checkout/ (above) still goes to /book.
  { source: '/checkout/:path+', destination: '/contact', example: '/checkout/order-pay/1234/?pay_for_order=true&key=wc_order_x' },
  // Yoast's sitemaps, the ones Search Console has on file.
  { source: '/sitemap_index.xml', destination: '/sitemap.xml', example: '/sitemap_index.xml' },
  { source: '/:name([a-z0-9_-]+-sitemap\\d*)\\.xml', destination: '/sitemap.xml', example: '/product_cat-sitemap.xml' },
  // Old post images (Google Images has them). Nothing here replaces them one for one.
  { source: '/wp-content/uploads/:path*', destination: '/', example: '/wp-content/uploads/2024/01/manatee.jpg' },
];

/** `/foo/` → `/foo`; `/` stays `/`. */
export function stripTrailingSlash(path: string): string {
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
}

/** The redirect rules `next.config.ts` serves, specific rules first. */
export function buildLegacyRedirects() {
  const specific = legacyUrls
    .filter((u) => u.action === 'redirect')
    .map((u) => ({
      source: stripTrailingSlash(u.from),
      destination: u.to,
      permanent: true,
    }));
  const catchAlls = legacyCatchAlls.map((c) => ({
    source: c.source,
    destination: c.destination,
    permanent: true,
  }));
  return [...specific, ...catchAlls];
}

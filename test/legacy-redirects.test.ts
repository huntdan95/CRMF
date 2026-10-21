/**
 * The old WordPress URLs (src/lib/legacy-redirects.ts), run through Next's
 * own redirect matcher with the rules next.config.ts serves, Next's
 * trailing-slash rule first, as the server orders them. No server needed;
 * `npm run check:redirects` checks a running one. Run with `npm test`.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import loadCustomRoutes from 'next/dist/lib/load-custom-routes';
import { getPathMatch } from 'next/dist/shared/lib/router/utils/path-match';
import { prepareDestination } from 'next/dist/shared/lib/router/utils/prepare-destination';

import nextConfig from '../next.config';
import { legacyCatchAlls, legacyUrls } from '../src/lib/legacy-redirects';

type Follow = (from: string) => { hops: number[]; path: string; search: string };

async function redirectFollower(): Promise<Follow> {
  const { redirects } = await loadCustomRoutes(nextConfig);
  // The options Next's router uses (server/lib/router-utils/filesystem.js).
  const rules = redirects.map((r) => ({
    ...r,
    match: getPathMatch(r.source, { strict: true, removeUnnamedParams: true, sensitive: false }),
  }));
  return (from) => {
    let url = new URL(from, 'https://crystalrivermanateefun.com');
    const hops: number[] = [];
    for (let i = 0; i < 6; i++) {
      const rule = rules.find((r) => r.match(url.pathname));
      if (!rule) break;
      const params = rule.match(url.pathname) as Record<string, string | string[]>;
      const { parsedDestination } = prepareDestination({
        appendParamsToQuery: false,
        destination: rule.destination,
        params,
        query: Object.fromEntries(url.searchParams),
      });
      const search = new URLSearchParams(parsedDestination.query as Record<string, string>).toString();
      hops.push(rule.permanent ? 308 : 307);
      url = new URL(parsedDestination.pathname + (search ? `?${search}` : ''), url);
    }
    return { hops, path: url.pathname, search: url.search };
  };
}

describe('legacy redirects', async () => {
  const follow = await redirectFollower();

  function assertLands(from: string, to: string) {
    const r = follow(from);
    assert.equal(r.path, to.split('#')[0], `${from} ended at ${r.path}`);
    assert.ok(r.hops.length <= 2, `${from}: ${r.hops.length} hops`);
    assert.ok(r.hops.every((s) => s === 308), `${from}: ${r.hops.join(', ')}`);
  }

  test('every sitemap URL lands where Appendix A says, in two permanent hops at most', () => {
    for (const u of legacyUrls) assertLands(u.from, u.to);
  });

  test("every catch-all's example lands on its destination", () => {
    for (const c of legacyCatchAlls) assertLands(c.example, c.destination);
  });

  test('WooCommerce, Yoast, feed and upload URLs outside the sitemap', () => {
    assertLands('/checkout/order-pay/1234/?pay_for_order=true&key=wc_order_abc', '/contact');
    assertLands('/checkout/order-received/1234/', '/contact');
    assertLands('/sitemap_index.xml', '/sitemap.xml');
    assertLands('/post-sitemap.xml', '/sitemap.xml');
    assertLands('/page-sitemap2.xml', '/sitemap.xml');
    assertLands('/feed/atom/', '/news');
    assertLands('/news/manatee-tours-manatee-habitat/feed/', '/news');
    assertLands('/wp-content/uploads/2024/01/IMG_0001.jpg', '/');
  });

  test('the old Book Now and wetsuit pages go to the indexable /tours, not /book', () => {
    assertLands('/book-now/', '/tours');
    assertLands('/wetsuit-sizing/', '/tours');
  });

  test('pages of the new site are left alone, so nothing loops', () => {
    for (const path of ['/', '/sitemap.xml', '/robots.txt', '/tours', '/contact', '/news', '/waiver', '/book',
      '/news/an-unforgettable-experience']) {
      assert.deepEqual(follow(path).hops, [], path);
    }
  });

  test('the query string comes through', () => {
    assert.equal(follow('/book-now/?utm_source=x').search, '?utm_source=x');
  });
});

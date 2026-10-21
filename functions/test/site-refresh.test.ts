/**
 * Refreshing the site's pages after an admin change (lib/site-refresh.ts),
 * and the tour and rate-season endpoints that do it: the change is saved and
 * answered as saved whether or not the site can be reached. Also what those
 * endpoints refuse, and the price changes they answer with. Run with
 * `npm test` in functions/.
 */
import { afterEach, describe, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { getAuth } from 'firebase-admin/auth';
import { Timestamp } from 'firebase-admin/firestore';
import type { Request } from 'firebase-functions/v2/https';

import { db } from '../src/lib/firebase';
import { refreshSitePages, revalidateKey } from '../src/lib/site-refresh';
import { adminUpdateTour } from '../src/adminTours';
import { adminDeleteRateSeason, adminUpsertRateSeason, seasonPriceChanges } from '../src/adminRateSeasons';
import { adminUpdateSettings } from '../src/adminSettings';
import { fakeFirestore } from './fakes';

const MCP = 'mcp-test-token-0123456789abcdefghijklmnop';

// Secrets and params are read from the environment when a request runs.
process.env.MCP_TOKEN = MCP;
process.env.ADMIN_EMAIL = 'travis@example.com';
process.env.APP_BASE_URL = 'https://example.com/';

afterEach(() => mock.restoreAll());

/** Stands in for fetch, recording each call and answering with `answer`. */
function fakeFetch(answer: (n: number) => Promise<Response>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fn = mock.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return answer(calls.length);
  });
  return { fetch: fn as unknown as typeof fetch, calls };
}

const unreachable = () => Promise.reject(new TypeError('fetch failed'));

describe('refreshSitePages', () => {
  test('posts to the site’s /api/revalidate with the key worked out from MCP_TOKEN', async () => {
    const site = fakeFetch(async () => Response.json({ ok: true }));
    assert.equal(await refreshSitePages({ fetch: site.fetch }), true);
    assert.equal(site.calls.length, 1);
    assert.equal(site.calls[0]!.url, 'https://example.com/api/revalidate');
    assert.equal(site.calls[0]!.init.method, 'POST');
    assert.deepEqual(site.calls[0]!.init.headers, { Authorization: `Bearer ${revalidateKey(MCP)}` });
  });

  test('never throws: the site down, refusing, or not set up is logged and answered false', async () => {
    const logged = mock.method(console, 'error', () => {});
    mock.method(console, 'warn', () => {});
    assert.equal(await refreshSitePages({ fetch: fakeFetch(unreachable).fetch }), false);
    assert.equal(
      await refreshSitePages({ fetch: fakeFetch(async () => Response.json({ error: 'Unauthorized.' }, { status: 401 })).fetch }),
      false,
    );
    assert.equal(logged.mock.callCount(), 2);

    const site = fakeFetch(async () => Response.json({ ok: true }));
    assert.equal(await refreshSitePages({ fetch: site.fetch, baseUrl: '' }), false);
    assert.equal(await refreshSitePages({ fetch: site.fetch, token: '' }), false);
    assert.equal(site.calls.length, 0);
  });
});

/** Calls an endpoint the way Cloud Functions would and returns its answer. */
async function call(fn: (req: Request, res: never) => unknown, body: Record<string, unknown>) {
  const req = { method: 'POST', headers: { authorization: `Bearer ${MCP}` }, body, header: () => undefined } as unknown as Request;
  const answer = { status: 200, body: undefined as unknown };
  const res = {
    status(code: number) {
      answer.status = code;
      return res;
    },
    json(b: unknown) {
      answer.body = b;
      return res;
    },
    send(b: unknown) {
      answer.body = b;
      return res;
    },
    set: () => res,
    setHeader: () => res,
    getHeader: () => undefined,
    on: () => res,
  };
  await fn(req, res as never);
  return answer;
}

/** The endpoints' Firestore, swapped for an in-memory one. */
function useFakeFirestore() {
  const fs = fakeFirestore({
    tours: { 'morning-shared': { slug: 'morning-shared', type: 'shared', name: 'Morning', pricePerPerson: 8400, flatPrice: null } },
  });
  mock.method(db, 'collection', fs.db.collection);
  mock.method(db, 'runTransaction', fs.db.runTransaction);
  return fs;
}

describe('price changes refresh the site', () => {
  test('a tour edit is saved and answered ok even when the site can’t be reached', async () => {
    const fs = useFakeFirestore();
    const site = fakeFetch(unreachable);
    mock.method(globalThis, 'fetch', site.fetch);
    const logged = mock.method(console, 'error', () => {});

    const answer = await call(adminUpdateTour, { slug: 'morning-shared', pricePerPerson: 9000 });

    assert.equal(answer.status, 200);
    assert.deepEqual(answer.body, { ok: true, priceChange: { fromCents: 8400, toCents: 9000 } });
    assert.equal(fs.col('tours').get('morning-shared')!.pricePerPerson, 9000);
    assert.equal(fs.col('auditLog').size, 1);
    assert.equal(site.calls.length, 1, 'it did try');
    assert.match(String(logged.mock.calls[0]!.arguments[0]), /Site refresh failed/);
  });

  test('a tour edit asks the site to refresh once the new price is saved', async () => {
    const fs = useFakeFirestore();
    const priceWhenAsked: unknown[] = [];
    const site = fakeFetch(async () => {
      priceWhenAsked.push(fs.col('tours').get('morning-shared')!.pricePerPerson);
      return Response.json({ ok: true });
    });
    mock.method(globalThis, 'fetch', site.fetch);

    const answer = await call(adminUpdateTour, { slug: 'morning-shared', pricePerPerson: 9000 });

    assert.equal(answer.status, 200);
    assert.equal(site.calls[0]!.url, 'https://example.com/api/revalidate');
    assert.deepEqual(priceWhenAsked, [9000]);
  });

  test('a seasonal rate is saved and deleted with the site down, refusing, or up', async () => {
    const fs = useFakeFirestore();
    const answers = [unreachable, async () => new Response('Internal error', { status: 500 }), async () => Response.json({ ok: true })];
    const site = fakeFetch((n) => answers[(n - 1) % answers.length]!());
    mock.method(globalThis, 'fetch', site.fetch);
    mock.method(console, 'error', () => {});

    for (let i = 0; i < answers.length; i++) {
      const saved = await call(adminUpsertRateSeason, {
        name: 'Peak season',
        startDate: '2027-01-01',
        endDate: '2027-03-31',
        prices: { 'morning-shared': 9500 },
      });
      assert.equal(saved.status, 200);
      const id = (saved.body as { id: string }).id;
      assert.equal(fs.col('rateSeasons').get(id)!.name, 'Peak season');
    }
    for (const id of [...fs.col('rateSeasons').keys()]) {
      const deleted = await call(adminDeleteRateSeason, { id });
      assert.equal(deleted.status, 200);
      assert.equal(fs.col('rateSeasons').has(id), false);
    }
    assert.equal(site.calls.length, 6);
    assert.equal(fs.col('auditLog').size, 6);
  });
});

describe('what the tour and rate-season endpoints refuse, and answer', () => {
  const quietSite = () => mock.method(globalThis, 'fetch', fakeFetch(async () => Response.json({ ok: true })).fetch);
  const season = { name: 'Christmas week', startDate: '2026-12-20', endDate: '2026-12-27', prices: { 'morning-shared': 9900 } };
  const loadedAt = { seconds: 1_790_000_000, nanoseconds: 120_000 };

  test('a season edit from a page loaded before a newer change is refused, not saved over it', async () => {
    const fs = useFakeFirestore();
    quietSite();
    // Claude raised it to $110 after the page was loaded at `loadedAt`.
    fs.col('rateSeasons').set('xmas', {
      id: 'xmas',
      ...season,
      prices: { 'morning-shared': 11000 },
      updatedAt: Timestamp.fromMillis(1_790_000_500_000),
    });

    const stale = await call(adminUpsertRateSeason, { id: 'xmas', ...season, endDate: '2026-12-28', expectedUpdatedAt: loadedAt });
    assert.equal(stale.status, 409);
    assert.match((stale.body as { error: string }).error, /changed after you opened it/);
    assert.deepEqual(fs.col('rateSeasons').get('xmas')!.prices, { 'morning-shared': 11000 });
    assert.equal(fs.col('auditLog').size, 0);

    // Loaded after Claude's change: saved.
    const fresh = await call(adminUpsertRateSeason, {
      id: 'xmas',
      ...season,
      prices: { 'morning-shared': 11000 },
      endDate: '2026-12-28',
      expectedUpdatedAt: { seconds: 1_790_000_500, nanoseconds: 0 },
    });
    assert.equal(fresh.status, 200);
    assert.equal(fs.col('rateSeasons').get('xmas')!.endDate, '2026-12-28');
  });

  test('MCP, which sends no version, still replaces the season, and is told what changed', async () => {
    const fs = useFakeFirestore();
    quietSite();
    fs.col('rateSeasons').set('xmas', { id: 'xmas', ...season, updatedAt: Timestamp.fromMillis(1_790_000_500_000) });

    const saved = await call(adminUpsertRateSeason, { id: 'xmas', ...season, prices: { 'morning-shared': 990 } });
    assert.equal(saved.status, 200);
    assert.deepEqual((saved.body as { priceChanges: unknown }).priceChanges, [
      { tour: 'morning-shared', fromCents: 9900, toCents: 990 },
    ]);
    assert.deepEqual(fs.col('rateSeasons').get('xmas')!.prices, { 'morning-shared': 990 });
  });

  test('deleting a season that isn’t there is a 404, with nothing logged', async () => {
    const fs = useFakeFirestore();
    quietSite();
    const answer = await call(adminDeleteRateSeason, { id: 'Christmas week' });
    assert.equal(answer.status, 404);
    assert.deepEqual(answer.body, { error: 'Season not found' });
    assert.equal(fs.col('auditLog').size, 0);
  });

  test('a field the endpoints won’t take is named in words, not “Invalid input”', async () => {
    useFakeFirestore();
    quietSite();
    const longLine = await call(adminUpdateTour, { slug: 'morning-shared', included: ['x'.repeat(230)] });
    assert.equal(longLine.status, 400);
    assert.equal((longLine.body as { error: string }).error, 'Each line of “What’s included” can be up to 200 characters.');
    const longName = await call(adminUpdateTour, { slug: 'morning-shared', name: 'x'.repeat(121) });
    assert.equal((longName.body as { error: string }).error, 'The name can be up to 120 characters.');
    const tooDear = await call(adminUpsertRateSeason, { ...season, prices: { 'morning-shared': 94_000_000 } });
    assert.equal(tooDear.status, 400);
    assert.equal((tooDear.body as { error: string }).error, 'Prices can be at most $100,000.');
  });
});

describe('seasonPriceChanges', () => {
  const standard = { 'morning-shared': 8400, 'morning-private': 50000, 'sunset-private': 40000 };

  test('each tour from its old season price, or its standard price, to the new one', () => {
    assert.deepEqual(
      seasonPriceChanges({ 'morning-shared': 9900, 'sunset-private': 45000 }, { 'morning-shared': 9900, 'morning-private': 60000 }, standard),
      [
        { tour: 'sunset-private', fromCents: 45000, toCents: 40000 },
        { tour: 'morning-private', fromCents: 50000, toCents: 60000 },
      ],
    );
  });

  test('a new season changes prices from the standard ones', () => {
    assert.deepEqual(seasonPriceChanges(null, { 'morning-shared': 840, 'morning-private': 50000 }, standard), [
      { tour: 'morning-shared', fromCents: 8400, toCents: 840 },
    ]);
  });
});

describe('settings changes refresh the site', () => {
  test('saving the wetsuit sizes refreshes /book, as the policy text does; settings the pages don’t show don’t', async () => {
    const fs = fakeFirestore({ settings: {} });
    mock.method(db, 'doc', (path: string) => {
      const [c, id] = path.split('/');
      return fs.db.collection(c!).doc(id!);
    });
    mock.method(db, 'collection', fs.db.collection);
    // Settings takes Travis's sign-in, not the MCP token.
    mock.method(getAuth(), 'verifyIdToken', async () => ({ uid: 'u1', email: 'travis@example.com', email_verified: true }));
    const site = fakeFetch(async () => Response.json({ ok: true }));
    mock.method(globalThis, 'fetch', site.fetch);

    const sizes = { adult: ['S', 'M', 'L'], kids: ['Kids 8'] };
    const saved = await call(adminUpdateSettings, { wetsuitSizes: sizes });
    assert.equal(saved.status, 200);
    assert.deepEqual(fs.col('settings').get('site')!.wetsuitSizes, sizes);
    assert.equal(site.calls.length, 1, 'the dropdown on /book shows the new sizes');

    await call(adminUpdateSettings, { cancellationPolicyText: 'Full refund 72 hours out.' });
    assert.equal(site.calls.length, 2);

    await call(adminUpdateSettings, { contactEmail: 'hello@example.com', closureUndoMinutes: 5 });
    assert.equal(site.calls.length, 2);
  });
});

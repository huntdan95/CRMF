/**
 * Refreshing the site's pages after an admin change (lib/site-refresh.ts),
 * and the tour and rate-season endpoints that do it: the change is saved and
 * answered as saved whether or not the site can be reached. Run with
 * `npm test` in functions/.
 */
import { afterEach, describe, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { getAuth } from 'firebase-admin/auth';
import type { Request } from 'firebase-functions/v2/https';

import { db } from '../src/lib/firebase';
import { refreshSitePages, revalidateKey } from '../src/lib/site-refresh';
import { adminUpdateTour } from '../src/adminTours';
import { adminDeleteRateSeason, adminUpsertRateSeason } from '../src/adminRateSeasons';
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
    assert.deepEqual(answer.body, { ok: true });
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

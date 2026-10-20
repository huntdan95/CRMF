/**
 * Crew sign-in (signInCrew in src/lib/crew-server.ts) against an in-memory
 * Firestore that logs the calls it gets: a wrong password makes the same
 * reads and writes whether or not the email is on the crew, so how long it
 * takes doesn't give the crew's addresses away. Run with `npm test`.
 */
import { afterEach, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import type { Timestamp } from 'firebase-admin/firestore';

// Nothing here reaches Firestore; the admin SDK only needs a project to start.
process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:1';
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ??= 'demo-crmf';

// `server-only` throws outside a React Server Components build: stand in for it.
const load = Module.createRequire(__filename);
const serverOnly = load.resolve('server-only');
load.cache[serverOnly] = { id: serverOnly, filename: serverOnly, loaded: true, exports: {} } as NodeJS.Module;
const { adminDb } = load('../src/lib/firebase/admin') as typeof import('../src/lib/firebase/admin');
const { signInCrew, sha256 } = load('../src/lib/crew-server') as typeof import('../src/lib/crew-server');

type Doc = Record<string, unknown>;

/** Docs by path, and a log of each round trip a sign-in makes. */
function fakeDb(initial: Record<string, Doc>) {
  const store = new Map(Object.entries(initial));
  const calls: string[] = [];
  const snap = (path: string) => {
    const d = store.get(path);
    return { id: path.split('/').pop()!, exists: !!d, ref: { path }, data: () => (d ? { ...d } : undefined) };
  };
  const db = adminDb();
  mock.method(db, 'collection', (name: string) => ({
    doc: (id: string) => ({ path: `${name}/${id}` }),
    where: (field: string, _op: string, value: unknown) => ({
      limit: () => ({
        get: async () => {
          calls.push('query');
          return { docs: [...store.entries()].filter(([p, d]) => p.startsWith(`${name}/`) && d[field] === value).map(([p]) => snap(p)) };
        },
      }),
    }),
  }));
  mock.method(db, 'runTransaction', async (fn: (tx: unknown) => Promise<unknown>) => {
    const writes: Array<[string, Doc]> = [];
    const tx = {
      get: async (r: { path: string }) => {
        calls.push('read 1');
        return snap(r.path);
      },
      getAll: async (...refs: Array<{ path: string }>) => {
        calls.push(`read ${refs.length}`);
        return refs.map((r) => snap(r.path));
      },
      update: (r: { path: string }, d: Doc) => void writes.push([r.path, d]),
      set: (r: { path: string }, d: Doc) => void writes.push([r.path, d]),
    };
    const result = await fn(tx);
    calls.push(`commit ${writes.length}`);
    for (const [p, d] of writes) store.set(p, { ...store.get(p), ...d });
    return result;
  });
  return { store, calls };
}

afterEach(() => mock.restoreAll());

const LACY = 'crew/lacy0123456789abcde';
const initial = (): Record<string, Doc> => ({
  [LACY]: { name: 'Lacy', email: 'lacy@example.com' },
  'crewCredentials/lacy0123456789abcde': { passwordHash: `scrypt:16384:8:1:${'B'.repeat(22)}:${'B'.repeat(86)}`, failedAttempts: 0 },
  // On the crew with an email, but no app password yet.
  'crew/faith0123456789abcd': { name: 'Faith', email: 'faith@example.com' },
});

async function wrongTry(calls: string[], email: string): Promise<string> {
  calls.length = 0;
  const result = await signInCrew(email, 'not-it', null);
  assert.equal(result.ok, false);
  return calls.join(', ');
}

test('a wrong password takes the same round trips whether or not the email is on the crew', async () => {
  const { store, calls } = fakeDb(initial());
  const crew = await wrongTry(calls, ' Lacy@Example.com');
  assert.equal(crew, 'query, read 2, commit 1');
  assert.equal(await wrongTry(calls, 'stranger@example.com'), crew);
  assert.equal(await wrongTry(calls, 'faith@example.com'), crew);

  // Lacy's tries are counted with her password, where a reset in admin
  // clears them; anyone else's under the address's hash.
  assert.equal(store.get('crewCredentials/lacy0123456789abcde')!.failedAttempts, 1);
  assert.equal(store.get(`crewSignInAttempts/${sha256('stranger@example.com')}`)!.failedAttempts, 1);
  assert.equal(store.get(`crewSignInAttempts/${sha256('faith@example.com')}`)!.failedAttempts, 1);
  // Expires a day on, for Firestore's TTL to clear (firestore.indexes.json).
  const expires = (store.get(`crewSignInAttempts/${sha256('stranger@example.com')}`)!.expiresAt as { toMillis(): number }).toMillis();
  assert.ok(expires > Date.now() + 23 * 3600_000 && expires <= Date.now() + 24 * 3600_000);
});

test('ten wrong tries lock any address for 15 minutes, the same way', async () => {
  const { store, calls } = fakeDb(initial());
  for (let i = 0; i < 10; i++) {
    await wrongTry(calls, 'lacy@example.com');
    await wrongTry(calls, 'stranger@example.com');
  }
  // The eleventh locks it.
  assert.equal(await wrongTry(calls, 'lacy@example.com'), 'query, read 2, commit 1');
  assert.equal(await wrongTry(calls, 'stranger@example.com'), 'query, read 2, commit 1');
  const lockedUntil = store.get('crewCredentials/lacy0123456789abcde')!.lockedUntil as Timestamp;
  assert.ok(lockedUntil.toMillis() > Date.now() + 14 * 60_000);
  // Locked: read, nothing written, for both.
  assert.equal(await wrongTry(calls, 'lacy@example.com'), 'query, read 2, commit 0');
  assert.equal(await wrongTry(calls, 'stranger@example.com'), 'query, read 2, commit 0');
});

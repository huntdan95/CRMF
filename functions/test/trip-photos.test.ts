/**
 * Trip photos: names that are safe to save, which trips get the photos
 * email, who counts as on the boat, one Drive copy at a time per file, and
 * Drive copies waiting while Drive won't take them. Against an in-memory
 * Firestore and a stand-in for Google. Run with `npm test` in functions/.
 */
import { Readable } from 'node:stream';
import { before, describe, test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { Timestamp } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

import { db as liveDb } from '../src/lib/firebase';
import { accountRefusal, copyToDrive, DriveRefusedError } from '../src/lib/google-drive';
import { onTheBoat } from '../src/lib/trip-photos';
import { fakeFirestore, type Doc } from './fakes';

// The Storage trigger in tripPhotos.ts needs a default bucket to load.
process.env.FIREBASE_CONFIG ??= JSON.stringify({ projectId: 'demo-test', storageBucket: 'demo-test.appspot.com' });
let photos: typeof import('../src/tripPhotos');
before(async () => {
  photos = await import('../src/tripPhotos');
});

const PREFIX = '0123abcd-1111-4222-8333-444455556666-';

describe('displayName', () => {
  test('the name the crew’s phone gave it, without the uploader’s prefix', () => {
    assert.equal(photos.displayName(`trips/2026-10-17_morning/${PREFIX}GOPR0001.JPG`), 'GOPR0001.JPG');
    // Only the UUID goes, not a first word that happens to look like hex.
    assert.equal(photos.displayName(`trips/2026-10-17_morning/${PREFIX}face-bad.jpg`), 'face-bad.jpg');
  });

  test('nothing that reads as a folder, a drive or a hidden file when it’s saved', () => {
    assert.equal(photos.displayName(`trips/t/${PREFIX}x\\..\\..\\Startup\\run.jpg`), 'x_.._.._Startup_run.jpg');
    assert.equal(photos.displayName(`trips/t/${PREFIX}C:evil.jpg`), 'C_evil.jpg');
    assert.equal(photos.displayName(`trips/t/${PREFIX}..hidden.jpg`), 'hidden.jpg');
    assert.equal(photos.displayName(`trips/t/${PREFIX}a\u0000b.jpg`), 'a_b.jpg');
    assert.equal(photos.displayName(`trips/t/${PREFIX}...`), 'photo');
  });
});

describe('readyForPhotosEmail', () => {
  const trip = (data: Doc) => ({ get: (field: string) => data[field] });
  const uploaded = { date: '2026-10-17', uploadToken: 'u'.repeat(32), photoCount: 12, lastUploadAt: Timestamp.fromDate(new Date('2026-10-17T20:00:00Z')) };
  // 9:30 AM marina time the day after.
  const morningAfter = new Date('2026-10-18T13:30:00Z');

  test('from 9 AM the day after, once uploads have stopped for an hour', () => {
    assert.equal(photos.readyForPhotosEmail(trip(uploaded), morningAfter), true);
    assert.equal(photos.readyForPhotosEmail(trip(uploaded), new Date('2026-10-18T12:30:00Z')), false, '8:30 AM');
    const justNow = { ...uploaded, lastUploadAt: Timestamp.fromDate(new Date('2026-10-18T13:00:00Z')) };
    assert.equal(photos.readyForPhotosEmail(trip(justNow), morningAfter), false, 'still uploading');
    assert.equal(photos.readyForPhotosEmail(trip({ ...uploaded, photoCount: 0 }), morningAfter), false, 'all deleted');
  });

  test('not a trip from the old Drive-only uploader: a count, but nothing in the gallery', () => {
    const oldFlow = { ...uploaded, uploadToken: undefined };
    assert.equal(photos.readyForPhotosEmail(trip(oldFlow), morningAfter), false);
  });
});

describe('onTheBoat', () => {
  test('the gallery’s rule: went out, old-site deposits too; not a trip Travis called off', () => {
    const b = (status: string, extra: Doc = {}) => ({ id: 'b1', status, ...extra }) as Parameters<typeof onTheBoat>[0];
    const closure = { blackoutId: 'bo1', reason: 'Weather', decideBy: '2026-10-20' } as Doc['closure'];
    assert.equal(onTheBoat(b('confirmed')), true);
    assert.equal(onTheBoat(b('completed')), true);
    assert.equal(onTheBoat({ ...b('pending-payment'), id: 'legacy-9' }), true);
    assert.equal(onTheBoat(b('pending-payment')), false, 'still in checkout');
    assert.equal(onTheBoat(b('confirmed', { closure })), false, 'choosing after a closure');
    assert.equal(onTheBoat(b('completed', { closure })), true, 'marked completed after all');
    assert.equal(onTheBoat(b('no-show')), false);
    assert.equal(onTheBoat(b('cancelled')), false);
  });
});

describe('claimForCopy', () => {
  function setup(drive: Doc) {
    const fake = fakeFirestore({ files: { f1: { name: 'GOPR0001.JPG', drive } } });
    const ref = fake.db.collection('files').doc('f1') as unknown as FirebaseFirestore.DocumentReference;
    const current = () => fake.col('files').get('f1')!.drive as { status: string; attempts: number; leaseUntil: Timestamp | null };
    return { fake, ref, drive: current };
  }

  test('the upload trigger and the hourly retry never copy the same file at once', async (t) => {
    const { fake, ref, drive } = setup({ status: 'pending', attempts: 0 });
    t.mock.method(liveDb, 'runTransaction', fake.db.runTransaction);

    assert.ok(await photos.claimForCopy(ref), 'the first copy takes it');
    assert.equal(await photos.claimForCopy(ref), null, 'a second one leaves it');
    assert.equal(drive().attempts, 0);
    assert.ok(drive().leaseUntil!.toMillis() > Date.now() + 14 * 60_000, 'held past the 9-minute timeout');
  });

  test('a copy whose function was stopped part way is taken again, and counts as a try', async (t) => {
    const { fake, ref, drive } = setup({ status: 'pending', attempts: 1, leaseUntil: Timestamp.fromMillis(Date.now() - 1000) });
    t.mock.method(liveDb, 'runTransaction', fake.db.runTransaction);

    assert.ok(await photos.claimForCopy(ref));
    assert.equal(drive().attempts, 2);
  });

  test('the fifth stop gives up, and says so', async (t) => {
    const { fake, ref, drive } = setup({ status: 'pending', attempts: 4, leaseUntil: Timestamp.fromMillis(Date.now() - 1000) });
    t.mock.method(liveDb, 'runTransaction', fake.db.runTransaction);

    assert.equal(await photos.claimForCopy(ref), null);
    assert.deepEqual(drive(), { status: 'failed', attempts: 5, leaseUntil: null, error: 'The copy kept stopping part way.' });
  });

  test('not one already in Drive, given up on, or deleted', async (t) => {
    for (const d of [{ status: 'copied', attempts: 0 }, { status: 'failed', attempts: 5 }]) {
      const { fake, ref } = setup(d);
      t.mock.method(liveDb, 'runTransaction', fake.db.runTransaction);
      assert.equal(await photos.claimForCopy(ref), null, d.status);
    }
    const { fake } = setup({ status: 'pending' });
    t.mock.method(liveDb, 'runTransaction', fake.db.runTransaction);
    const gone = fake.db.collection('files').doc('nope') as unknown as FirebaseFirestore.DocumentReference;
    assert.equal(await photos.claimForCopy(gone), null);
  });
});

/* -------------------------------------------------------------------------- */
/* Drive refusing every file                                                  */
/* -------------------------------------------------------------------------- */

const FULL = JSON.stringify({
  error: {
    code: 403,
    message: 'The user’s Drive storage quota has been exceeded.',
    errors: [{ domain: 'usageLimits', reason: 'storageQuotaExceeded', message: 'The user’s Drive storage quota has been exceeded.' }],
  },
});

/**
 * Firestore for the Drive copy: the connection, both folders already made,
 * and `files` as every trip's files (`trip` names the one each is in, as
 * `ref.parent.parent` would). Google answers the token, folder checks, and
 * an upload start with `start` (and its PUT with a file id).
 */
function driveWorld(t: TestContext, files: Record<string, Doc>, start: () => Response) {
  const fs = fakeFirestore({
    driveConfig: {
      oauth: { clientId: 'cid', clientSecret: 'secret', refreshToken: 'rt', lastError: null },
      tripPhotos: { rootFolderId: 'root' },
    },
    tripPhotos: Object.fromEntries(Object.values(files).map((f) => [f.trip as string, { folderId: `folder-${String(f.trip)}` }])),
    files,
  });
  t.mock.method(liveDb, 'doc', (path: string) => {
    const [c, id] = path.split('/');
    return fs.db.collection(c!).doc(id!);
  });
  t.mock.method(liveDb, 'runTransaction', fs.db.runTransaction);
  // The app here was set up without a default bucket. Nothing is read from
  // it: Google refuses the upload before the file is opened.
  const storage = getStorage();
  const bucket = storage.bucket.bind(storage);
  t.mock.method(storage, 'bucket', (name?: string) => bucket(name ?? 'demo-test.appspot.com'));
  type Q = { where: (...a: [string, string, unknown]) => Q; get: () => Promise<{ docs: Array<{ id: string; ref: Doc }> }> };
  const inTrips = (q: Q): Q => ({
    where: (...a) => inTrips(q.where(...a)),
    get: async () => {
      const snap = await q.get();
      for (const d of snap.docs) d.ref.parent = { parent: { id: fs.col('files').get(d.id)!.trip } };
      return snap;
    },
  });
  t.mock.method(liveDb, 'collectionGroup', (name: string) => inTrips(fs.db.collection(name) as unknown as Q));
  const starts: string[] = [];
  const deletes: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    if (u.endsWith('/token')) return Response.json({ access_token: 'at', expires_in: 3600 });
    if (init?.method === 'DELETE') {
      deletes.push(u.split('/').pop()!);
      return new Response(null, { status: 204 });
    }
    if (u.includes('/upload/drive/v3/files')) {
      starts.push(JSON.parse(String(init?.body)).name);
      return start();
    }
    if (init?.method === 'PUT') return Response.json({ id: 'drive-file-1' });
    // A folder check: still there.
    return Response.json({ id: 'folder', trashed: false });
  });
  return { fs, starts, deletes, oauth: () => fs.col('driveConfig').get('oauth')! };
}

const waitingFile = (name: string, trip: string, drive: Doc): Doc => ({
  trip,
  name,
  storagePath: `trips/${trip}/${PREFIX}${name}`,
  contentType: 'image/jpeg',
  size: 3,
  drive,
});

describe('Drive refusing every file', () => {
  test('“Drive is full” and “the API is off” are the account’s, not one file’s', () => {
    assert.match(accountRefusal(FULL)!, /Google Drive is full/);
    const off = JSON.stringify({ error: { code: 403, status: 'PERMISSION_DENIED', errors: [{ reason: 'accessNotConfigured' }], details: [{ reason: 'SERVICE_DISABLED' }] } });
    assert.match(accountRefusal(off)!, /API is turned off/);
    assert.equal(accountRefusal(JSON.stringify({ error: { code: 403, errors: [{ reason: 'insufficientFilePermissions' }] } })), null);
    assert.equal(accountRefusal('<html>Bad gateway</html>'), null);
  });

  test('the hourly retry takes waiting files however old the trip, and stops at a full Drive without using a try', async (t) => {
    const { fs, starts, oauth } = driveWorld(
      t,
      {
        // Signed out in January, long before the retry's run.
        f1: waitingFile('GOPR0001.JPG', '2026-01-05_morning', { status: 'not-connected', attempts: 0 }),
        f2: waitingFile('GOPR0002.JPG', '2026-01-05_morning', { status: 'failed', attempts: 2 }),
        done: waitingFile('GOPR0003.JPG', '2026-01-05_morning', { status: 'copied', attempts: 0 }),
        gaveUp: waitingFile('GOPR0004.JPG', '2026-01-05_morning', { status: 'failed', attempts: 5 }),
      },
      () => new Response(FULL, { status: 403 }),
    );
    mockLogs(t);

    assert.equal(await photos.runDriveRetry(), 0);

    assert.deepEqual(starts, ['GOPR0001.JPG'], 'one try, then it stops: the rest would be refused too');
    const f1 = fs.col('files').get('f1')!.drive as Doc;
    assert.equal(f1.status, 'not-connected');
    assert.equal(f1.attempts, 0, 'no try used');
    assert.equal(f1.leaseUntil, null);
    assert.equal(fs.col('files').get('f2')!.drive!.attempts, 2, 'not tried this run');
    assert.match(oauth().lastRefusal as string, /Google Drive is full/, 'Settings says so');
  });

  test('a full Drive is a DriveRefusedError, and the next copy that lands clears what Settings says', async (t) => {
    let full = true;
    const { oauth } = driveWorld(t, { f1: waitingFile('a.jpg', '2026-10-17_morning', { status: 'pending', attempts: 0 }) }, () =>
      full
        ? new Response(FULL, { status: 403 })
        : new Response(null, { status: 200, headers: { location: 'https://upload.example/session' } }),
    );
    const copy = () =>
      copyToDrive({ tripId: '2026-10-17_morning', folderName: 'f', name: 'a.jpg', mimeType: 'image/jpeg', size: 3, open: () => Readable.from(['abc']) });

    await assert.rejects(copy(), DriveRefusedError);
    assert.ok(oauth().lastRefusal);

    full = false;
    assert.equal(await copy(), 'drive-file-1');
    assert.equal(oauth().lastRefusal, null);
  });
});

/* -------------------------------------------------------------------------- */
/* A copy that lands but can't be recorded, and deleting a photo's copy       */
/* -------------------------------------------------------------------------- */

describe('Drive copies nothing can reach', () => {
  /**
   * A copy that lands in Drive (the file is read from a stand-in for
   * Storage), then the transaction recording it fails. `committed`: the
   * record went through, and only the answer was lost.
   */
  async function recordFails(t: TestContext, committed: boolean) {
    const world = driveWorld(t, { f1: waitingFile('a.jpg', '2026-10-17_morning', { status: 'pending', attempts: 0 }) }, () =>
      new Response(null, { status: 200, headers: { location: 'https://upload.example/session' } }),
    );
    t.mock.method(getStorage(), 'bucket', () => ({ file: () => ({ createReadStream: () => Readable.from(['abc']) }) }));
    let transactions = 0;
    t.mock.method(liveDb, 'runTransaction', async (fn: (tx: unknown) => Promise<unknown>) => {
      // The first takes the file (claimForCopy); the second records the copy.
      if (++transactions === 1) return world.fs.db.runTransaction(fn);
      if (committed) await world.fs.db.runTransaction(fn);
      throw new Error('4 DEADLINE_EXCEEDED');
    });
    mockLogs(t);
    assert.equal(await photos.runDriveRetry(), 0);
    assert.deepEqual(world.starts, ['a.jpg']);
    return world;
  }

  test('a copy that couldn’t be recorded is deleted, so the retry’s copy is the only one', async (t) => {
    const { deletes, fs } = await recordFails(t, false);
    assert.deepEqual(deletes, ['drive-file-1']);
    assert.equal(fs.col('files').get('f1')!.drive!.fileId, undefined);
  });

  test('one whose record went through after all is kept', async (t) => {
    const { deletes, fs } = await recordFails(t, true);
    assert.deepEqual(deletes, []);
    assert.equal(fs.col('files').get('f1')!.drive!.fileId, 'drive-file-1');
  });

  test('deleting a photo says whether its Drive copy went: deleted, Drive not connected, or Drive refused', async (t) => {
    const { fs, deletes } = driveWorld(t, {}, () => new Response(null, { status: 500 }));
    mockLogs(t);
    const log = { tripId: '2026-10-17_morning', fileId: 'f1' };
    assert.equal(await photos.removeDriveCopy('drive-file-1', log), 'deleted');
    assert.deepEqual(deletes, ['drive-file-1']);

    t.mock.method(globalThis, 'fetch', async (url: string | URL) =>
      String(url).endsWith('/token') ? Response.json({ access_token: 'at', expires_in: 3600 }) : new Response('{}', { status: 500 }),
    );
    assert.equal(await photos.removeDriveCopy('drive-file-1', log), 'failed');

    // Disconnected: before, this counted as deleted.
    fs.col('driveConfig').delete('oauth');
    assert.equal(await photos.removeDriveCopy('drive-file-1', log), 'not-connected');
  });
});

/** Keeps the copies' logging out of the test output. */
function mockLogs(t: TestContext) {
  for (const level of ['log', 'info', 'warn', 'error'] as const) t.mock.method(console, level, () => {});
}

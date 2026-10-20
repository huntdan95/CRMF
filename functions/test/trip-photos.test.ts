/**
 * Trip photos: names that are safe to save, which trips get the photos
 * email, who counts as on the boat, and one Drive copy at a time per file.
 * Against an in-memory Firestore. Run with `npm test` in functions/.
 */
import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Timestamp } from 'firebase-admin/firestore';

import { db as liveDb } from '../src/lib/firebase';
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

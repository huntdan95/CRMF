/**
 * The crew's booking pushes (notifyCrewOfBooking in crewNotifications.ts),
 * run as the trigger against an in-memory Firestore with the push services
 * stubbed: a new booking, and a move of any booking going ahead, old-site
 * ones included, but not what the old-site import script writes. Run with
 * `npm test` in functions/.
 */
import { describe, test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import webpush from 'web-push';
import { Timestamp } from 'firebase-admin/firestore';

import { db as liveDb } from '../src/lib/firebase';
import { notifyCrewOfBooking } from '../src/crewNotifications';
import { fakeFirestore, type Doc } from './fakes';

process.env.VAPID_PRIVATE_KEY = 'test-private-key';
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:1';

// Far enough ahead that it's never in the past or about to leave.
const FROM = '2099-05-12';
const TO = '2099-05-14';

/** Points the trigger's Firestore at an in-memory one and records the pushes it sends. */
function world(t: TestContext, initial: Record<string, Record<string, Doc>>) {
  const fs = fakeFirestore(initial);
  // Queries take `select` (which fields come back) and return everything.
  type Q = { where: (...a: unknown[]) => Q; select?: () => Q };
  const selectable = (q: Q): Q => ({ ...q, where: (...a) => selectable(q.where(...a)), select: () => selectable(q) });
  t.mock.method(liveDb, 'collection', (name: string) => {
    const c = fs.db.collection(name) as unknown as Q;
    return { ...c, where: (...a: unknown[]) => selectable(c.where(...a)) };
  });
  const pushes: Array<{ title: string; body: string }> = [];
  t.mock.method(webpush, 'sendNotification', async (_sub: unknown, payload: string) => {
    const { title, body } = JSON.parse(payload) as { title: string; body: string };
    pushes.push({ title, body });
    return { statusCode: 201, body: '', headers: {} };
  });
  return pushes;
}

function booking(over: Doc = {}): Doc {
  return {
    tourId: 'morning-shared',
    tourName: 'Morning tour',
    date: FROM,
    timeSlot: 'morning',
    type: 'shared',
    guestCount: 4,
    customerName: 'Ann',
    status: 'confirmed',
    updatedAt: Timestamp.fromMillis(2_000),
    ...over,
  };
}

/** Runs the trigger for one write of `bookings/{id}`; `after` is what's stored. */
async function write(t: TestContext, id: string, before: Doc | undefined, after: Doc, others: Record<string, Doc> = {}) {
  const pushes = world(t, {
    bookings: { ...others, [id]: after },
    crewPushSubscriptions: { s1: { crewId: 'lacy', endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: 'p', auth: 'a' } } },
  });
  const snap = (d: Doc | undefined) => ({ exists: !!d, data: () => d });
  await (notifyCrewOfBooking as unknown as { run: (e: unknown) => Promise<void> }).run({
    data: { before: snap(before), after: snap(after) },
    params: { bookingId: id },
  });
  return pushes;
}

const legacy = (over: Doc = {}) => ({ bookingId: 42, importedAt: Timestamp.fromMillis(1_000), ...over });

describe('the crew push for a booking', () => {
  test('a booking moved: the crew hear where it went and where it was', async (t) => {
    const before = booking();
    const pushes = await write(t, 'b1', before, { ...before, date: TO, updatedAt: Timestamp.fromMillis(3_000) });
    assert.deepEqual(pushes, [{ title: 'Booking moved: Thu, May 14', body: '8:00 AM · Morning tour · 4 guests · Was Tue, May 12, 8:00 AM' }]);
  });

  test('an old-site booking moved, paid in full or held with a deposit: the crew hear of it too', async (t) => {
    for (const status of ['confirmed', 'pending-payment'] as const) {
      const before = booking({ status, legacy: legacy() });
      const pushes = await write(t, 'legacy-42', before, { ...before, timeSlot: 'mid-morning', updatedAt: Timestamp.fromMillis(3_000) });
      assert.deepEqual(pushes, [{ title: 'Booking moved: Tue, May 12', body: '10:30 AM · Morning tour · 4 guests · Was Tue, May 12, 8:00 AM' }], status);
    }
  });

  test('an old-site booking with no party size moved onto a trip with others on it', async (t) => {
    const before = booking({ status: 'pending-payment', guestCount: 0, legacy: legacy() });
    const after = { ...before, date: TO, updatedAt: Timestamp.fromMillis(3_000) };
    const pushes = await write(t, 'legacy-42', before, after, { b2: booking({ date: TO, guestCount: 2 }) });
    assert.equal(pushes[0]!.body, '8:00 AM · Morning tour · party size unknown (2+ on the boat) · Was Tue, May 12, 8:00 AM');
  });

  test('the import script moving one on a re-sync tells nobody', async (t) => {
    const before = booking({ legacy: legacy() });
    // `--update-existing` stamps updatedAt with the run's own time, as legacy.importedAt.
    const run = Timestamp.fromMillis(5_000);
    const after = { ...before, date: TO, updatedAt: run, legacy: legacy({ importedAt: run }) };
    assert.deepEqual(await write(t, 'legacy-42', before, after), []);
  });

  test('a new booking: the crew hear when it’s paid; not an old-site one imported, nor a move of a booking not going ahead', async (t) => {
    const paid = booking();
    assert.deepEqual(await write(t, 'b1', { ...paid, status: 'pending-payment' }, paid), [
      { title: 'New booking: Tue, May 12', body: '8:00 AM · Morning tour · 4 guests' },
    ]);
    assert.deepEqual(await write(t, 'legacy-42', undefined, booking({ legacy: legacy(), updatedAt: Timestamp.fromMillis(1_000) })), []);
    // A checkout still in Stripe isn't on the crew's list, wherever it is.
    const checkout = booking({ status: 'pending-payment' });
    assert.deepEqual(await write(t, 'b2', checkout, { ...checkout, date: TO }), []);
  });
});

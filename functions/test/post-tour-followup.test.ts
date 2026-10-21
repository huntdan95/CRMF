/**
 * The day-after "how was your tour?" email: not for a trip on a departure
 * Travis closed. Against an in-memory stand-in for Firestore. Run with
 * `npm test` in functions/.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { sendPostTourFollowupEmail } from '../src/postTourFollowup';
import { db as liveDb } from '../src/lib/firebase';
import { marinaNow } from '../src/lib/datetime';
import { TOKEN, fakeDb, type Doc } from './fakes';

/** Yesterday at the marina: the trips the 7 AM run thanks. */
function yesterday(): string {
  const d = new Date(`${marinaNow().date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

const booking = (extra: Doc = {}): Doc => ({
  id: 'b1',
  tourId: 'morning-shared',
  tourName: '2hr Morning Tour — Shared',
  date: yesterday(),
  timeSlot: 'morning',
  type: 'shared',
  guestCount: 2,
  customerName: 'Pat Example',
  customerEmail: 'pat@example.com',
  accessToken: TOKEN,
  status: 'confirmed',
  ...extra,
});

describe('sendPostTourFollowupEmail', () => {
  test('not on a departure Travis closed and left them booked, even from the admin button', async (t) => {
    const { db, store } = fakeDb(
      { b1: booking() },
      { blackouts: [{ date: yesterday(), affectedSlots: ['morning'], reason: 'weather' }] },
    );
    t.mock.method(liveDb, 'collection', db.collection);

    assert.deepEqual(await sendPostTourFollowupEmail('b1'), { sent: false, skipped: 'closed' });
    assert.deepEqual(await sendPostTourFollowupEmail('b1', true), { sent: false, skipped: 'closed' });
    assert.equal(store.get('b1')!.postTourFollowupSentAt, undefined);
  });
});

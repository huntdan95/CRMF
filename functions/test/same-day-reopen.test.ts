/**
 * Reopening a day Travis closed and left booked, after one of its trips has
 * left with someone still booked on it (assertReopenable in
 * lib/close-day.ts). A blackout comes down as a whole, so reopening at
 * 11:00 to run the 1:00 used to make the 8:00 that didn't go count as a
 * trip that ran: its guests got "How was your manatee tour?". Now the
 * reopen waits until he has marked, moved or cancelled them. Against an
 * in-memory Firestore; emails land in the emulator outbox. Run with
 * `npm test` in functions/.
 */
import { describe, test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';

import { db as liveDb } from '../src/lib/firebase';
import { runReviewList, runReviewRequests } from '../src/reviewRequests';
import { ClosureError, assertClosable, assertReopenable, restoreOfferedBookings } from '../src/lib/close-day';
import { adminMarkOne } from '../src/lib/admin-mark';
import { marinaNow } from '../src/lib/datetime';
import { TOKEN, fakeFirestore, type Doc } from './fakes';

process.env.RESEND_API_KEY = 'emulator-outbox';
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:1';
process.env.RESEND_FROM_EMAIL = 'Manatee Fun <hello@example.com>';
process.env.ADMIN_EMAIL = 'travis@example.com';
process.env.APP_BASE_URL = 'https://example.com';

// Tuesday, November 10, 2026 (EST).
const day = '2026-11-10';
const blackout = { date: day, affectedSlots: ['all'] };
const ELEVEN = new Date('2026-11-10T16:00:00Z');

function booking(id: string, over: Doc = {}): Doc {
  return {
    id,
    tourId: 'morning-shared',
    tourName: '2hr Morning Tour — Shared',
    date: day,
    timeSlot: 'morning',
    type: 'shared',
    guestCount: 2,
    guests: [],
    customerName: `Guest ${id}`,
    customerEmail: `${id}@example.com`,
    customerPhone: '352-555-0100',
    accessToken: TOKEN,
    status: 'confirmed',
    paymentStatus: 'paid',
    amountPaidCents: 16800,
    amountRefundedCents: 0,
    ...over,
  };
}

/** Points the functions' Firestore at an in-memory one (as automation-runs.test.ts does). */
function world(t: TestContext) {
  const fs = fakeFirestore({
    bookings: {
      // On the 8:00, which didn't go at 8 because of the weather.
      a: booking('a'),
      // On the 1:00, which can go after all.
      b: booking('b', { timeSlot: 'early-afternoon', tourId: 'early-afternoon-shared' }),
    },
    // Closed at 6 AM, "Whole day, leave them booked".
    blackouts: { bo1: { ...blackout, reason: 'weather', notes: null } },
    closureActions: { bo1: { state: 'done', choice: 'keep', date: day, affectedSlots: ['all'] } },
  });
  type Q = { where: (...a: unknown[]) => Q; select?: () => Q };
  const selectable = (q: Q): Q => ({ ...q, where: (...a) => selectable(q.where(...a)), select: () => selectable(q) });
  t.mock.method(liveDb, 'collection', (name: string) => {
    const c = fs.db.collection(name) as unknown as Q;
    return { ...c, where: (...a: unknown[]) => selectable(c.where(...a)) };
  });
  t.mock.method(liveDb, 'runTransaction', fs.db.runTransaction);
  t.mock.method(liveDb, 'doc', (path: string) => {
    const [name, id] = path.split('/');
    return fs.db.collection(name!).doc(id!);
  });
  t.mock.method(liveDb, 'batch', () => {
    const ops: Array<() => Promise<unknown>> = [];
    return {
      set: (r: { set: (d: Doc) => Promise<unknown> }, d: Doc) => void ops.push(() => r.set(d)),
      update: (r: { update: (d: Doc) => Promise<unknown> }, d: Doc) => void ops.push(() => r.update(d)),
      commit: async () => {
        for (const op of ops) await op();
      },
    };
  });
  /** Who was asked "How was your manatee tour?" (not Travis's 6 PM list). */
  const reviewed = () =>
    [...fs.col('emailOutbox').values()]
      .map((e) => (e.to as string[]).join(','))
      .filter((to) => to !== 'travis@example.com')
      .sort();
  /** Reopen as adminDeleteBlackout does, once it's allowed. */
  const reopen = async () => {
    await assertReopenable('bo1', blackout, { now: ELEVEN });
    await restoreOfferedBookings('bo1', { now: ELEVEN });
    fs.col('blackouts').delete('bo1');
  };
  const evening = async () => {
    await runReviewList(new Date('2026-11-10T23:00:00Z'));
    await runReviewRequests(new Date('2026-11-11T00:00:00Z'));
  };
  return { ...fs, reviewed, reopen, evening };
}

describe('reopening a day to run a later trip after an earlier one has left', () => {
  test('refused while the 8:00 has someone still booked on it; moved, they get no review request', async (t) => {
    const w = world(t);
    // 11:00: the 1:00 can go, and Travis reopens the day. The 8:00 can't be
    // closed again once it has left, so the reopen is what's refused.
    await assert.rejects(
      assertReopenable('bo1', blackout, { now: ELEVEN }),
      (err: unknown) => err instanceof ClosureError && err.status === 409 && /^The 8:00 AM trip on Tue Nov 10 has already left with Guest a still booked/.test(err.message),
    );
    assert.throws(() => assertClosable(day, ['morning'], marinaNow(ELEVEN), []), /already left/);
    assert.ok(w.col('blackouts').has('bo1'));

    // It didn't go: Travis moves them to Thursday, then the day reopens.
    w.col('bookings').set('a', { ...w.col('bookings').get('a'), date: '2026-11-12' });
    await w.reopen();
    await w.evening();
    assert.deepEqual(w.reviewed(), ['b@example.com']);
  });

  test('if the 8:00 went out after all, marked on its own, the day reopens and both get the request', async (t) => {
    const w = world(t);
    assert.deepEqual(await adminMarkOne('a', 'completed', { now: ELEVEN, ranAnyway: true }), { kind: 'marked', closedBy: ['bo1'] });
    await w.reopen();
    await w.evening();
    assert.deepEqual(w.reviewed(), ['a@example.com', 'b@example.com']);
  });
});

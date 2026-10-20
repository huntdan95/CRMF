/**
 * A reopen that failed partway (the blackout still up) is retried after
 * the put-back booking's trip has left. assertReopenable refuses and says
 * to move it; Travis moves it; the next reopen mustn't list it as back on
 * its old trip, or tell the crew that trip is back on. Follows
 * adminDeleteBlackout's order: assertReopenable, restoreOfferedBookings,
 * delete, alertCrewRestoredOnce.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Timestamp } from 'firebase-admin/firestore';
import {
  ClosureError,
  alertCrewRestoredOnce,
  assertReopenable,
  restoreOfferedBookings,
} from '../src/lib/close-day';
import { adminRescheduleOne } from '../src/lib/admin-reschedule';
import { TOKEN, fakeFirestore, type Doc } from './fakes';

const DAY = '2026-10-17'; // Saturday
function booking(id: string, over: Doc = {}): Doc {
  return {
    id, tourId: 'morning-shared', tourName: '2hr Morning Tour — Shared', date: DAY, timeSlot: 'morning', type: 'shared',
    guestCount: 2, guests: [], customerName: `Guest ${id}`, customerEmail: `${id}@example.com`, customerPhone: '555-0100',
    accessToken: TOKEN, status: 'confirmed', paymentStatus: 'paid', amountPaidCents: 16800, amountRefundedCents: 0,
    stripePaymentIntentId: 'pi_1', updatedAt: Timestamp.fromMillis(1_000), ...over,
  };
}

test('moved after the refusal, then reopened: not listed as back on its old trip, crew not told', async () => {
  const closure = { blackoutId: 'bo1', reason: 'Closed for weather', decideBy: '2026-10-20', offeredAt: Timestamp.fromMillis(1_000) };
  const told = { claimedAt: Timestamp.fromMillis(1_000), sentAt: Timestamp.fromMillis(1_000) };
  const offered = ['a', 'late'].map((id) => ({ id, customerName: `Guest ${id}`, timeSlot: id === 'a' ? 'morning' : 'late-afternoon', guests: 2, decideBy: '2026-10-20', emailed: true }));
  let commits = 0;
  const fs = fakeFirestore(
    {
      bookings: {
        a: booking('a', { closure }),
        late: booking('late', { closure, timeSlot: 'late-afternoon', tourId: 'late-afternoon-shared' }),
      },
      blackouts: { bo1: { date: DAY, affectedSlots: ['all'], createdAt: Timestamp.fromMillis(1_000) } },
      closureActions: {
        bo1: { state: 'done', date: DAY, affectedSlots: ['all'], choice: 'offer', crewAlert: told, result: { cancelled: [], offered, failed: [] }, createdAt: Timestamp.fromMillis(1_000) },
      },
      crew: { lacy: { name: 'Lacy', email: 'lacy@example.com' } },
      tours: { 'morning-shared': { slug: 'morning-shared', name: '2hr Morning Tour — Shared', type: 'shared', timeSlot: 'morning', maxGuests: 6 } },
    },
    { beforeCommit: () => { if (++commits === 2) throw new Error('Firestore unavailable'); } },
  );
  // 7:50 AM Sat: the reopen puts a back, then fails on late. Blackout stays.
  const t750 = new Date('2026-10-17T11:50:00Z');
  await assert.rejects(restoreOfferedBookings('bo1', { db: fs.db, now: t750 }), /Firestore unavailable/);
  assert.ok(fs.col('blackouts').has('bo1'));
  // 10:00: retry. Refused, naming a: "move or cancel it. Then reopen."
  const t1000 = new Date('2026-10-17T14:00:00Z');
  await assert.rejects(
    assertReopenable('bo1', { date: DAY, affectedSlots: ['all'] }, { db: fs.db, now: t1000 }),
    (e: unknown) => e instanceof ClosureError,
  );
  // Travis moves a to Tuesday, as told.
  const moved = await adminRescheduleOne('a', { newDate: '2026-10-20', newTourSlug: 'morning-shared' }, {
    db: fs.db, now: t1000, getTour: async () => ({ slug: 'morning-shared', name: '2hr Morning Tour — Shared', type: 'shared', timeSlot: 'morning', maxGuests: 6 } as never),
  });
  assert.equal(moved.kind, 'moved');
  // Reopen again, as adminDeleteBlackout does.
  await assertReopenable('bo1', { date: DAY, affectedSlots: ['all'] }, { db: fs.db, now: t1000 });
  const all = await restoreOfferedBookings('bo1', { db: fs.db, now: t1000 });
  const back = all.filter((r) => !r.left);
  fs.col('blackouts').delete('bo1');
  const subjects: string[] = [];
  const crew = { push: async () => {}, email: async ({ subject }: { subject: string }) => void subjects.push(subject) };
  await alertCrewRestoredOnce('bo1', back, { db: fs.db, crew, now: t1000, baseUrl: 'https://example.com' });
  assert.ok(!all.some((r) => r.id === 'a'), 'a, moved to Tuesday, is not listed at all');
  assert.ok(!subjects.some((s) => /8:00/.test(s)), `crew not told the 8:00 is back on: ${subjects.join(' | ')}`);
});

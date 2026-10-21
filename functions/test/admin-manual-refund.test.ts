/**
 * "Refunded by hand": Travis recording that he's paid back the old-site
 * money a cancellation left owing. Only on a cancelled booking with money
 * owed, once, and the amount stays for Reports. Against an in-memory
 * stand-in for Firestore. Run with `npm test` in functions/.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';

import { adminManualRefundOne } from '../src/lib/admin-manual-refund';
import { serializeBooking } from '../src/fetchBooking';
import type { Booking } from '../src/lib/types';
import { TOKEN, fakeDb, type Doc } from './fakes';

const owed = (id: string, extra: Doc = {}): Doc => ({
  id,
  tourId: 'morning-shared',
  date: '2026-11-20',
  timeSlot: 'morning',
  type: 'shared',
  status: 'cancelled',
  guestCount: 2,
  customerName: 'Pat Example',
  accessToken: TOKEN,
  paymentStatus: 'paid',
  amountPaidCents: 9000,
  amountRefundedCents: 0,
  manualRefundCents: 9000,
  legacy: { bookingId: 7 } as Doc['legacy'],
  ...extra,
});

describe('adminManualRefundOne', () => {
  test('stamps when it was refunded and keeps the amount, in one transaction', async () => {
    const { db, store, commits } = fakeDb({ 'legacy-7': owed('legacy-7') });

    assert.deepEqual(await adminManualRefundOne('legacy-7', { db }), { kind: 'recorded', manualRefundCents: 9000 });

    const after = store.get('legacy-7')!;
    assert.ok(after.manualRefundedAt instanceof FieldValue, 'stamped with the server time');
    assert.equal(after.manualRefundCents, 9000, 'Reports keep counting it as given back');
    assert.equal(after.amountRefundedCents, 0, 'nothing went through Stripe here');
    assert.equal(after.status, 'cancelled');
    assert.deepEqual(commits, [{ reads: ['bookings/legacy-7'], writes: ['bookings/legacy-7'] }]);
  });

  test('a second tap changes nothing', async () => {
    const at = Timestamp.fromDate(new Date('2026-10-20T15:00:00Z'));
    const { db, store, commits } = fakeDb({ 'legacy-7': owed('legacy-7', { manualRefundedAt: at }) });

    assert.deepEqual(await adminManualRefundOne('legacy-7', { db }), { kind: 'already-recorded' });
    assert.equal(store.get('legacy-7')!.manualRefundedAt, at);
    assert.deepEqual(commits.flatMap((c) => c.writes), []);
  });

  test('only a cancelled booking with money owed back by hand', async () => {
    const { db, commits } = fakeDb({
      active: owed('active', { status: 'confirmed' }),
      stripe: owed('stripe', { manualRefundCents: undefined, amountRefundedCents: 9000 }),
      zero: owed('zero', { manualRefundCents: 0 }),
    });

    for (const id of ['active', 'stripe', 'zero']) {
      assert.deepEqual(await adminManualRefundOne(id, { db }), { kind: 'nothing-owed' }, id);
    }
    assert.deepEqual(await adminManualRefundOne('nope', { db }), { kind: 'not-found' });
    assert.deepEqual(commits.flatMap((c) => c.writes), []);
  });

  test('the customer’s booking page gets the date, or null', () => {
    const at = Timestamp.fromDate(new Date('2026-10-20T15:00:00Z'));
    assert.equal(serializeBooking(owed('a', { manualRefundedAt: at }) as Booking).manualRefundedAt, '2026-10-20T15:00:00.000Z');
    assert.equal(serializeBooking(owed('b') as Booking).manualRefundedAt, null);
  });
});

/**
 * Travis editing a booking's party size or contact details, against an
 * in-memory stand-in for Firestore. Run with `npm test` in functions/.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { adminEditOne } from '../src/lib/admin-edit';
import type { Tour } from '../src/lib/types';
import { TOKEN, fakeDb, type Doc } from './fakes';

const tour = { slug: 'morning-shared', type: 'shared', timeSlot: 'morning', maxGuests: 6 } as Tour;
const getTour = async (slug: string) => (slug === tour.slug ? tour : null);

const booking = (id: string, guestCount: number, more: Doc = {}): Doc => ({
  id,
  tourId: 'morning-shared',
  date: '2099-07-04',
  timeSlot: 'morning',
  type: 'shared',
  status: 'confirmed',
  guestCount,
  customerName: 'Pat Example',
  customerPhone: '352-555-0100',
  accessToken: TOKEN,
  ...more,
});

describe('adminEditOne', () => {
  test('raises the party size when the boat has room, checking seats in the same transaction as the write', async () => {
    const { db, store, commits } = fakeDb({ b1: booking('b1', 2), b2: booking('b2', 3) });

    const r = await adminEditOne('b1', { guestCount: 3 }, { db, getTour });

    assert.equal(r.kind, 'updated');
    if (r.kind !== 'updated') return;
    assert.deepEqual(r.before, { guestCount: 2 });
    assert.equal(r.after.guestCount, 3);
    assert.equal(store.get('b1')!.guestCount, 3);
    assert.deepEqual(commits, [
      { reads: ['bookings/b1', 'bookings where date == 2099-07-04'], writes: ['bookings/b1'] },
    ]);
  });

  test('refuses when the boat doesn’t have the seats', async () => {
    const { db, store } = fakeDb({ b1: booking('b1', 2), b2: booking('b2', 3) });

    const r = await adminEditOne('b1', { guestCount: 4 }, { db, getTour });

    assert.deepEqual(r, { kind: 'slot-full', message: 'Cannot raise to 4 — only 3 spots free in this slot.' });
    assert.equal(store.get('b1')!.guestCount, 2);
  });

  test('a booking made while the edit is saving can’t take the same seats', async () => {
    const { db, store } = fakeDb(
      { b1: booking('b1', 2), b2: booking('b2', 2) },
      {
        beforeCommit: (s, attempt) => {
          // A customer books the last two seats just before the edit lands.
          if (attempt === 1) s.set('b3', booking('b3', 2, { status: 'pending-payment' }));
        },
      },
    );

    const r = await adminEditOne('b1', { guestCount: 4 }, { db, getTour });

    assert.deepEqual(r, { kind: 'slot-full', message: 'Cannot raise to 4 — only 2 spots free in this slot.' });
    assert.equal(store.get('b1')!.guestCount, 2, 'the boat is not oversold');
  });

  test('cancelled bookings and other departures don’t take seats', async () => {
    const { db, store } = fakeDb({
      b1: booking('b1', 2),
      b2: booking('b2', 4, { status: 'cancelled' }),
      b3: booking('b3', 4, { timeSlot: 'mid-morning' }),
      b4: booking('b4', 4, { status: 'no-show' }),
    });

    const r = await adminEditOne('b1', { guestCount: 6 }, { db, getTour });

    assert.equal(r.kind, 'updated');
    assert.equal(store.get('b1')!.guestCount, 6);
  });

  test('lowering the party size never needs free seats', async () => {
    // Overfull already, e.g. Travis squeezed someone on by phone.
    const { db, store, commits } = fakeDb({ b1: booking('b1', 4), b2: booking('b2', 4) });

    const r = await adminEditOne('b1', { guestCount: 3 }, { db, getTour });

    assert.equal(r.kind, 'updated');
    assert.equal(store.get('b1')!.guestCount, 3);
    assert.deepEqual(commits[0]!.reads, ['bookings/b1']);
  });

  test('a private charter has the boat to itself, so no seat check', async () => {
    const { db, store } = fakeDb({ b1: booking('b1', 2, { type: 'private', tourId: 'morning-private' }) });

    const r = await adminEditOne('b1', { guestCount: 6 }, { db, getTour });

    assert.equal(r.kind, 'updated');
    assert.equal(store.get('b1')!.guestCount, 6);
  });

  test('contact details save with what they were before, for the audit log', async () => {
    const { db, store } = fakeDb({ b1: booking('b1', 2) });

    const r = await adminEditOne('b1', { customerName: 'Pat Q. Example', customerPhone: '352-555-0199' }, { db, getTour });

    assert.equal(r.kind, 'updated');
    if (r.kind !== 'updated') return;
    assert.deepEqual(r.before, { customerName: 'Pat Example', customerPhone: '352-555-0100' });
    assert.equal(store.get('b1')!.customerName, 'Pat Q. Example');
    assert.equal(store.get('b1')!.customerPhone, '352-555-0199');
  });

  test('nothing to change, or no such booking', async () => {
    const { db, commits } = fakeDb({ b1: booking('b1', 2) });
    assert.deepEqual(await adminEditOne('b1', {}, { db, getTour }), { kind: 'nothing-to-update' });
    assert.deepEqual(await adminEditOne('nope', { guestCount: 3 }, { db, getTour }), { kind: 'not-found' });
    assert.deepEqual(commits.flatMap((c) => c.writes), []);
  });

  test('a shared booking whose tour is gone can’t be raised', async () => {
    const { db, store } = fakeDb({ b1: booking('b1', 2, { tourId: 'retired-tour' }) });
    assert.deepEqual(await adminEditOne('b1', { guestCount: 3 }, { db, getTour }), { kind: 'tour-missing' });
    assert.equal(store.get('b1')!.guestCount, 2);
  });
});

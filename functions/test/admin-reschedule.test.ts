/**
 * Travis moving a booking to another date or tour: the same seat rules as
 * online booking, no departure that's already left, and nothing changes if
 * the booking was cancelled or moved meanwhile. Against an in-memory
 * stand-in for Firestore. Run with `npm test` in functions/.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Firestore } from 'firebase-admin/firestore';

import { adminRescheduleOne, emailMovedBooking } from '../src/lib/admin-reschedule';
import type { Booking, Tour } from '../src/lib/types';
import { TOKEN, fakeDb, type Doc } from './fakes';

// 9:00 AM at the marina (EDT) on Thursday, October 15, 2026.
const NOW = new Date('2026-10-15T13:00:00Z');
const DAY = '2026-10-20';

const tour = (slug: string, timeSlot: Tour['timeSlot'], type: Tour['type']) =>
  ({ slug, name: slug, timeSlot, type, maxGuests: 6, active: true }) as Tour;
const TOURS = [
  tour('morning-shared', 'morning', 'shared'),
  tour('morning-private', 'morning', 'private'),
  tour('mid-morning-shared', 'mid-morning', 'shared'),
  tour('late-afternoon-shared', 'late-afternoon', 'shared'),
  tour('sunset-private', 'sunset', 'private'),
  tour('whole-day-private', 'whole-day', 'private'),
];
const getTour = async (slug: string) => TOURS.find((t) => t.slug === slug) ?? null;

const booking = (id: string, extra: Doc = {}): Doc => ({
  id,
  tourId: 'mid-morning-shared',
  tourName: 'mid-morning-shared',
  date: '2026-10-18',
  timeSlot: 'mid-morning',
  type: 'shared',
  status: 'confirmed',
  guestCount: 2,
  customerName: 'Pat Example',
  customerEmail: 'pat@example.com',
  customerPhone: '352-555-0100',
  accessToken: TOKEN,
  ...extra,
});

const move = (db: Firestore, newDate: string, newTourSlug: string, now = NOW) =>
  adminRescheduleOne('b1', { newDate, newTourSlug }, { db, getTour, now });

describe('adminRescheduleOne', () => {
  test('moves the booking, settles a closure, and checks seats against the booking read in the same transaction', async () => {
    const { db, store, commits } = fakeDb({
      b1: booking('b1', { closure: { reason: 'Weather', decideBy: '2026-10-17' } as Doc['closure'] }),
      b2: booking('b2', { date: DAY, timeSlot: 'morning', tourId: 'morning-shared', guestCount: 4 }),
    });

    const r = await move(db, DAY, 'morning-shared');

    assert.equal(r.kind, 'moved');
    if (r.kind !== 'moved') return;
    assert.deepEqual(r.before, {
      date: '2026-10-18',
      timeSlot: 'mid-morning',
      tourId: 'mid-morning-shared',
      tourName: 'mid-morning-shared',
      type: 'shared',
    });
    assert.equal(r.booking.date, DAY);
    assert.equal(r.booking.closure, undefined);
    const saved = store.get('b1')!;
    assert.deepEqual([saved.date, saved.timeSlot, saved.tourId, saved.type], [DAY, 'morning', 'morning-shared', 'shared']);
    assert.equal(saved.closure, undefined);
    assert.deepEqual(commits[0]!.reads, [
      'bookings/b1',
      `bookings where date == ${DAY}`,
      `blackouts where date == ${DAY}`,
    ]);
  });

  test('drops the full refund a reopened trip still had: the new trip is under the usual policy', async () => {
    const { db, store } = fakeDb({ b1: booking('b1', { refundGraceUntil: '2026-10-21' }) });

    const r = await move(db, DAY, 'morning-shared');

    assert.equal(r.kind, 'moved');
    assert.equal(r.kind === 'moved' && r.booking.refundGraceUntil, undefined);
    assert.equal(store.get('b1')!.refundGraceUntil, undefined);
  });

  test('its own seats don’t count against it, so it can go private on the same departure', async () => {
    const { db, store } = fakeDb({ b1: booking('b1') });

    const r = await move(db, '2026-10-18', 'morning-private');
    assert.equal(r.kind, 'moved');
    assert.equal(store.get('b1')!.type, 'private');
  });

  test('a booking imported with no party size fills the boat, as it does for online booking', async () => {
    const { db, store } = fakeDb({
      b1: booking('b1'),
      b2: booking('b2', { date: DAY, timeSlot: 'morning', tourId: 'morning-shared', guestCount: 0, legacy: { bookingId: 4102 } }),
    });

    const r = await move(db, DAY, 'morning-shared');

    assert.equal(r.kind, 'unavailable');
    if (r.kind === 'unavailable') assert.equal(r.reason, 'slot-shared-full');
    assert.equal(store.get('b1')!.date, '2026-10-18');
  });

  test('the whole-day charter can’t go on a day with a departure inside its hours blacked out', async () => {
    const { db, store } = fakeDb(
      { b1: booking('b1', { type: 'private', tourId: 'morning-private', timeSlot: 'morning' }) },
      { blackouts: [{ date: DAY, affectedSlots: ['early-afternoon'] }] },
    );

    const r = await move(db, DAY, 'whole-day-private');

    assert.equal(r.kind, 'unavailable');
    if (r.kind === 'unavailable') assert.equal(r.reason, 'blackout-slot');
    assert.equal(store.get('b1')!.timeSlot, 'morning');
  });

  test('the 3:30 tour can’t take the boat from a sunset cruise booked late in the season', async () => {
    const { db } = fakeDb({
      b1: booking('b1'),
      b2: booking('b2', { date: DAY, timeSlot: 'sunset', tourId: 'sunset-private', type: 'private' }),
    });

    const r = await move(db, DAY, 'late-afternoon-shared');

    assert.equal(r.kind, 'unavailable');
    if (r.kind === 'unavailable') assert.equal(r.reason, 'slot-conflict');
  });

  test('cancelled or moved by the customer while saving: nothing changes', async () => {
    for (const meanwhile of [{ status: 'cancelled' }, { date: '2026-10-22', timeSlot: 'morning' }] as Doc[]) {
      const { db, store } = fakeDb(
        { b1: booking('b1') },
        {
          beforeCommit: (s, attempt) => {
            if (attempt === 1) s.set('b1', { ...s.get('b1')!, ...meanwhile });
          },
        },
      );

      const r = await move(db, DAY, 'morning-shared');

      assert.deepEqual(r, { kind: 'changed' });
      assert.deepEqual(store.get('b1'), { ...booking('b1'), ...meanwhile });
    }
  });

  test('a booking still being paid for online can’t be moved: the checkout would charge for the old tour', async () => {
    const { db, store, commits } = fakeDb({ b1: booking('b1', { status: 'pending-payment' }) });

    assert.deepEqual(await move(db, DAY, 'morning-shared'), { kind: 'still-paying' });
    assert.equal(store.get('b1')!.date, '2026-10-18');
    assert.deepEqual(commits, []);
  });

  test('an old-site reservation moves, but isn’t told it’s “locked in”', async () => {
    const { db, store } = fakeDb({
      b1: booking('b1', { status: 'pending-payment', legacy: { bookingId: 4102 } as Doc['legacy'] }),
    });

    const r = await move(db, DAY, 'morning-shared');

    assert.equal(r.kind, 'moved');
    if (r.kind !== 'moved') return;
    assert.equal(store.get('b1')!.date, DAY);
    let sent = 0;
    assert.deepEqual(await emailMovedBooking(r.booking, true, async () => void sent++), { emailed: false, reason: 'not-confirmed' });
    assert.equal(sent, 0);
  });

  test('a private booking imported with no party size can move to another private tour, not onto a shared one', async () => {
    const { db, store } = fakeDb({
      b1: booking('b1', { type: 'private', tourId: 'morning-private', timeSlot: 'morning', guestCount: 0, legacy: { bookingId: 4102 } as Doc['legacy'] }),
    });

    assert.deepEqual(await move(db, DAY, 'mid-morning-shared'), { kind: 'no-party-size' });
    assert.equal(store.get('b1')!.date, '2026-10-18');

    const r = await move(db, DAY, 'whole-day-private');
    assert.equal(r.kind, 'moved');
    assert.deepEqual([store.get('b1')!.date, store.get('b1')!.timeSlot], [DAY, 'whole-day']);
  });

  test('no date that isn’t on the calendar, has passed, or a departure that has left', async () => {
    const { db, store, commits } = fakeDb({ b1: booking('b1') });

    assert.deepEqual(await move(db, '2026-02-30', 'morning-shared'), { kind: 'invalid-date' });
    assert.deepEqual(await move(db, '2026-10-14', 'morning-shared'), { kind: 'past' });
    // 8:00 this morning.
    const r = await move(db, '2026-10-15', 'morning-shared');
    assert.equal(r.kind, 'unavailable');
    if (r.kind === 'unavailable') assert.equal(r.reason, 'departed');

    assert.equal(store.get('b1')!.date, '2026-10-18');
    assert.deepEqual(commits, []);
  });

  test('a trip leaving soon is fine: Travis can put someone on the next one out', async () => {
    const { db, store } = fakeDb({ b1: booking('b1') });

    // 10:00 AM; the 10:30 hasn't left.
    const r = await move(db, '2026-10-15', 'mid-morning-shared', new Date('2026-10-15T14:00:00Z'));

    assert.equal(r.kind, 'moved');
    assert.equal(store.get('b1')!.date, '2026-10-15');
  });

  test('only an active booking with a party size, to a tour that exists', async () => {
    const { db } = fakeDb({
      b1: booking('b1'),
      cancelled: booking('cancelled', { status: 'cancelled' }),
      noSize: booking('noSize', { guestCount: 0 }),
    });

    assert.deepEqual(await adminRescheduleOne('nope', { newDate: DAY, newTourSlug: 'morning-shared' }, { db, getTour, now: NOW }), { kind: 'not-found' });
    assert.deepEqual(await adminRescheduleOne('cancelled', { newDate: DAY, newTourSlug: 'morning-shared' }, { db, getTour, now: NOW }), { kind: 'not-active' });
    assert.deepEqual(await adminRescheduleOne('noSize', { newDate: DAY, newTourSlug: 'morning-shared' }, { db, getTour, now: NOW }), { kind: 'no-party-size' });
    assert.deepEqual(await move(db, DAY, 'retired-tour'), { kind: 'tour-missing' });
  });
});

describe('emailMovedBooking', () => {
  const moved = (extra: Partial<Booking> = {}) => ({ ...booking('b1'), date: DAY, ...extra }) as Booking;

  test('a confirmed booking gets its updated confirmation', async () => {
    const sent: string[] = [];
    const r = await emailMovedBooking(moved(), true, async (b) => void sent.push(b.date));
    assert.deepEqual(r, { emailed: true });
    assert.deepEqual(sent, [DAY]);
  });

  test('says why when it doesn’t go, so Travis knows to call', async () => {
    let sent = 0;
    const send = async () => void sent++;
    assert.deepEqual(await emailMovedBooking(moved(), false, send), { emailed: false, reason: 'not-asked' });
    assert.deepEqual(await emailMovedBooking(moved({ customerEmail: '' }), true, send), { emailed: false, reason: 'no-address' });
    assert.equal(sent, 0);

    const r = await emailMovedBooking(moved(), true, async () => {
      throw new Error('Resend failed: 422');
    });
    assert.deepEqual(r, { emailed: false, reason: 'failed' });
  });
});

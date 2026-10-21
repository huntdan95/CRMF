/**
 * Travis marking a trip completed or a no-show: only a trip that's going
 * ahead, a no-show once its departure has left and completed once it's
 * back, and never one waiting on a closure (unless a reopen under the
 * previous version left the closure behind: marking takes it off) or on a
 * departure Travis closed and left booked. Against
 * an in-memory stand-in for Firestore. Run with `npm test` in functions/.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { adminMarkOne } from '../src/lib/admin-mark';
import { TOKEN, fakeDb, type Doc } from './fakes';

// 9:00 AM at the marina (EDT) on Thursday, October 15, 2026.
const NOW = new Date('2026-10-15T13:00:00Z');
const TODAY = '2026-10-15';

const booking = (id: string, extra: Doc = {}): Doc => ({
  id,
  tourId: 'morning-shared',
  date: TODAY,
  timeSlot: 'morning',
  type: 'shared',
  status: 'confirmed',
  guestCount: 2,
  customerName: 'Pat Example',
  accessToken: TOKEN,
  ...extra,
});

const closure = { blackoutId: 'bo1', reason: 'Weather', decideBy: '2026-10-18' } as Doc['closure'];
/** The day the booking is on is still closed. */
const closedOn = (date: string) => ({ blackouts: [{ date, affectedSlots: ['all'] }] });

describe('adminMarkOne', () => {
  test('marks a confirmed trip once its departure has left, reading and writing in one transaction', async () => {
    const { db, store, commits } = fakeDb({ b1: booking('b1') });

    // The 8:00 left an hour ago.
    assert.deepEqual(await adminMarkOne('b1', 'no-show', { db, now: NOW }), { kind: 'marked' });

    assert.equal(store.get('b1')!.status, 'no-show');
    assert.deepEqual(commits, [{ reads: ['bookings/b1', `blackouts where date == ${TODAY}`], writes: ['bookings/b1'] }]);
  });

  test('completed only once the trip is back: while it’s out, the boat is still away', async () => {
    const wholeDay = () => booking('wd', { timeSlot: 'whole-day', tourId: 'whole-day-private', type: 'private' });
    const { db, store } = fakeDb({ wd: wholeDay() });

    // 7:05 AM: the 7:00–3:00 charter has gone. Marked completed now, the
    // 10:30, 1:00 and 3:30 would go back on sale with the boat out.
    const at705 = new Date('2026-10-15T11:05:00Z');
    assert.deepEqual(await adminMarkOne('wd', 'completed', { db, now: at705 }), { kind: 'not-back' });
    assert.equal(store.get('wd')!.status, 'confirmed');
    // A no-show is fine then: the party didn't come, so the boat is free.
    assert.deepEqual(await adminMarkOne('wd', 'no-show', { db, now: at705 }), { kind: 'marked' });
    assert.equal(store.get('wd')!.status, 'no-show');

    // 3:01 PM: back in.
    store.set('wd', wholeDay());
    assert.deepEqual(await adminMarkOne('wd', 'completed', { db, now: new Date('2026-10-15T19:01:00Z') }), { kind: 'marked' });
    assert.equal(store.get('wd')!.status, 'completed');
  });

  test('the sunset cruise is back two hours after its own time that day', async () => {
    // Oct 15, 2026: sunset just after 7:00 PM, so it leaves at 5:30 and is back at 7:30.
    const { db, store } = fakeDb({ sunset: booking('sunset', { timeSlot: 'sunset', tourId: 'sunset-private', type: 'private' }) });

    assert.deepEqual(await adminMarkOne('sunset', 'completed', { db, now: new Date('2026-10-15T23:29:00Z') }), { kind: 'not-back' });
    assert.deepEqual(await adminMarkOne('sunset', 'completed', { db, now: new Date('2026-10-15T23:30:00Z') }), { kind: 'marked' });
    assert.equal(store.get('sunset')!.status, 'completed');
  });

  test('not on the trip day before it leaves: its seats would go back on sale', async () => {
    const { db, store } = fakeDb({
      midMorning: booking('midMorning', { timeSlot: 'mid-morning', tourId: 'mid-morning-shared' }),
      sunset: booking('sunset', { timeSlot: 'sunset', tourId: 'sunset-private', type: 'private' }),
      tomorrow: booking('tomorrow', { date: '2026-10-16' }),
    });

    for (const id of ['midMorning', 'sunset', 'tomorrow']) {
      assert.deepEqual(await adminMarkOne(id, 'no-show', { db, now: NOW }), { kind: 'not-yet' }, id);
      assert.equal(store.get(id)!.status, 'confirmed');
    }
    // 10:31: the 10:30 has gone.
    assert.deepEqual(await adminMarkOne('midMorning', 'no-show', { db, now: new Date('2026-10-15T14:31:00Z') }), { kind: 'marked' });
    assert.equal(store.get('midMorning')!.status, 'no-show');
  });

  test('a reservation from the old site can be marked too', async () => {
    const { db, store } = fakeDb({
      'legacy-4102': booking('legacy-4102', {
        status: 'pending-payment',
        amountPaidCents: 5000,
        legacy: { bookingId: 4102, oldStatus: 'reserved' } as Doc['legacy'],
      }),
    });

    // 10:00: the 8:00 is back.
    assert.deepEqual(await adminMarkOne('legacy-4102', 'completed', { db, now: new Date('2026-10-15T14:00:00Z') }), { kind: 'marked' });
    assert.equal(store.get('legacy-4102')!.status, 'completed');
  });

  test('not while the customer is choosing a new date or a refund for a departure Travis closed', async () => {
    const { db, store } = fakeDb({ b1: booking('b1', { closure, date: '2026-10-14' }) }, closedOn('2026-10-14'));

    assert.deepEqual(await adminMarkOne('b1', 'no-show', { db, now: NOW }), { kind: 'closed' });
    assert.equal(store.get('b1')!.status, 'confirmed');
    assert.ok(store.get('b1')!.closure, 'still settled by the closure');
  });

  test('nor one the day was reopened on after its trip had left: they still choose', async () => {
    const { db, store } = fakeDb(
      { b1: booking('b1', { closure, date: '2026-10-14' }) },
      { others: { closureActions: { bo1: { state: 'done', date: '2026-10-14', reopenedAt: {} } } } },
    );

    assert.deepEqual(await adminMarkOne('b1', 'no-show', { db, now: NOW }), { kind: 'closed' });
    assert.equal(store.get('b1')!.status, 'confirmed');
  });

  test('a closure a reopen left behind doesn’t stop it, and marking takes the closure off with a note', async () => {
    // The previous version's reopen only took the blackout down.
    const { db, store } = fakeDb(
      { b1: booking('b1', { closure, adminNotes: 'Birthday' }), b2: booking('b2', { closure }) },
      { others: { closureActions: { bo1: { state: 'done', date: TODAY } } } },
    );

    // 10:00: the 8:00 is back.
    assert.deepEqual(await adminMarkOne('b1', 'completed', { db, now: new Date('2026-10-15T14:00:00Z') }), { kind: 'marked' });
    const b1 = store.get('b1')!;
    assert.equal(b1.status, 'completed');
    // Nothing refunds them at the deadline or offers them a new date now.
    assert.equal(b1.closure, undefined);
    assert.equal(
      b1.adminNotes,
      'Birthday\n2026-10-15: Marked completed after the day was reopened, so the offer of a new date or a refund (weather) no longer applies.',
    );

    assert.deepEqual(await adminMarkOne('b2', 'no-show', { db, now: NOW }), { kind: 'marked' });
    assert.equal(store.get('b2')!.closure, undefined);
    assert.match(String(store.get('b2')!.adminNotes), /^2026-10-15: Marked a no-show after the day was reopened/);
  });

  test('not on a departure Travis closed and left them booked on, the day after too: he moves or cancels it', async () => {
    const yesterday = '2026-10-14';
    const { db, store, commits } = fakeDb(
      {
        b1: booking('b1', { date: yesterday }),
        'legacy-4102': booking('legacy-4102', {
          date: yesterday,
          status: 'pending-payment',
          amountPaidCents: 5000,
          legacy: { bookingId: 4102, oldStatus: 'reserved' } as Doc['legacy'],
        }),
        wd: booking('wd', { date: yesterday, timeSlot: 'whole-day', tourId: 'whole-day-private', type: 'private' }),
        late: booking('late', { date: yesterday, timeSlot: 'late-afternoon', tourId: 'late-afternoon-shared' }),
      },
      // Closed with "leave them booked" (or from MCP): a blackout, no closure on the bookings.
      { blackouts: [{ date: yesterday, affectedSlots: ['morning'] }] },
    );

    assert.deepEqual(await adminMarkOne('b1', 'completed', { db, now: NOW }), { kind: 'departure-closed' });
    assert.deepEqual(await adminMarkOne('legacy-4102', 'no-show', { db, now: NOW }), { kind: 'departure-closed' });
    // Closing the 8:00 closes the whole-day charter that runs through it.
    assert.deepEqual(await adminMarkOne('wd', 'completed', { db, now: NOW }), { kind: 'departure-closed' });
    assert.deepEqual(commits.flatMap((c) => c.writes), []);
    assert.equal(store.get('b1')!.status, 'confirmed');

    // The 3:30 that day wasn't closed.
    assert.deepEqual(await adminMarkOne('late', 'completed', { db, now: NOW }), { kind: 'marked' });
    assert.equal(store.get('late')!.status, 'completed');
  });

  test('a trip on a departure he closed that went out after all: marked with ranAnyway, that one alone', async () => {
    const yesterday = '2026-10-14';
    const { db, store } = fakeDb(
      {
        ran: booking('ran', { date: yesterday, adminNotes: 'Window seat.' }),
        didnt: booking('didnt', { date: yesterday, timeSlot: 'early-afternoon', tourId: 'early-afternoon-shared' }),
        noShow: booking('noShow', { date: yesterday, timeSlot: 'mid-morning', tourId: 'mid-morning-shared' }),
      },
      // The whole day, left booked (bo0), and the 10:30 closed again from MCP (bo1, no closure action).
      {
        blackouts: [{ date: yesterday, affectedSlots: ['all'] }, { date: yesterday, affectedSlots: ['mid-morning'] }],
        others: { closureActions: { bo0: { state: 'done', choice: 'keep', date: yesterday } } },
      },
    );

    assert.deepEqual(await adminMarkOne('ran', 'completed', { db, now: NOW, ranAnyway: true }), { kind: 'marked', closedBy: ['bo0'] });
    assert.equal(store.get('ran')!.status, 'completed');
    assert.equal(store.get('ran')!.adminNotes, 'Window seat.\n2026-10-15: Marked completed: the trip went out after all, though you closed it.');
    assert.deepEqual(
      await adminMarkOne('noShow', 'no-show', { db, now: NOW, ranAnyway: true }),
      { kind: 'marked', closedBy: ['bo0', 'bo1'] },
    );
    assert.equal(store.get('noShow')!.status, 'no-show');

    // The 1:00 didn't go: without the flag it's still turned away, and the day is still closed.
    assert.deepEqual(await adminMarkOne('didnt', 'completed', { db, now: NOW }), { kind: 'departure-closed' });
    assert.equal(store.get('didnt')!.status, 'confirmed');
  });

  test('ranAnyway waits for the trip to leave (and to be back to complete), and for a closing in its undo window', async () => {
    const { db, store } = fakeDb(
      {
        early: booking('early'),
        late: booking('late', { timeSlot: 'early-afternoon', tourId: 'early-afternoon-shared' }),
      },
      {
        blackouts: [{ date: TODAY, affectedSlots: ['all'] }],
        others: { closureActions: { bo0: { state: 'done', choice: 'keep', date: TODAY } } },
      },
    );
    // 9:00 AM: the 8:00 is still out, the 1:00 hasn't left.
    assert.deepEqual(await adminMarkOne('late', 'no-show', { db, now: NOW, ranAnyway: true }), { kind: 'not-yet' });
    assert.deepEqual(await adminMarkOne('early', 'completed', { db, now: NOW, ranAnyway: true }), { kind: 'not-back' });
    assert.equal(store.get('early')!.status, 'confirmed');

    // A closing still in its undo window, or going out, may yet cancel them or offer a new date.
    for (const state of ['pending', 'finalizing']) {
      const w = fakeDb(
        { early: booking('early', { date: '2026-10-14' }) },
        {
          blackouts: [{ date: '2026-10-14', affectedSlots: ['morning'] }],
          others: { closureActions: { bo0: { state, choice: 'keep', date: '2026-10-14' } } },
        },
      );
      assert.deepEqual(await adminMarkOne('early', 'completed', { db: w.db, now: NOW, ranAnyway: true }), { kind: 'closing' }, state);
      assert.equal(w.store.get('early')!.status, 'confirmed', state);
    }
  });

  test('ranAnyway doesn’t mark one still choosing a new date', async () => {
    const { db } = fakeDb({ b1: booking('b1', { date: '2026-10-14', closure }) }, closedOn('2026-10-14'));
    assert.deepEqual(await adminMarkOne('b1', 'completed', { db, now: NOW, ranAnyway: true }), { kind: 'closed' });
  });

  test('a closure landing while it saves wins', async () => {
    const { db, store } = fakeDb(
      { b1: booking('b1') },
      {
        ...closedOn(TODAY),
        beforeCommit: (s, attempt) => {
          if (attempt === 1) s.set('b1', { ...s.get('b1')!, closure });
        },
      },
    );

    assert.deepEqual(await adminMarkOne('b1', 'no-show', { db, now: NOW }), { kind: 'closed' });
    assert.equal(store.get('b1')!.status, 'confirmed');
  });

  test('only a trip that’s going ahead', async () => {
    const { db, commits } = fakeDb({
      unpaid: booking('unpaid', { status: 'pending-payment' }),
      cancelled: booking('cancelled', { status: 'cancelled' }),
      done: booking('done', { status: 'completed' }),
    });

    assert.deepEqual(await adminMarkOne('unpaid', 'completed', { db, now: NOW }), { kind: 'not-going-ahead', status: 'pending-payment' });
    assert.deepEqual(await adminMarkOne('cancelled', 'no-show', { db, now: NOW }), { kind: 'not-going-ahead', status: 'cancelled' });
    assert.deepEqual(await adminMarkOne('done', 'no-show', { db, now: NOW }), { kind: 'not-going-ahead', status: 'completed' });
    assert.deepEqual(await adminMarkOne('nope', 'completed', { db, now: NOW }), { kind: 'not-found' });
    assert.deepEqual(commits.flatMap((c) => c.writes), []);
  });
});

/**
 * The booking calendar's seat rules (src/lib/availability.ts), which mirror
 * the Cloud Function's. Run with `npm test`.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ACTIVE_STATUSES,
  computeDay,
  computeRange,
  departureLeft,
  seasonWords,
  statusLabel,
  tourStatus,
  type BookingLite,
} from '../src/lib/availability';
import { tours } from '../src/lib/tours';

const now = { date: '2026-10-20', minutes: 9 * 60 };
const tour = (slug: string) => tours.find((t) => t.slug === slug)!;
const sunsetOn = (date: string): BookingLite => ({ date, timeSlot: 'sunset', type: 'private', guestCount: 4, status: 'confirmed' });

describe('the sunset cruise out of season', () => {
  test('isn’t sold, but one booked on it still takes the 3:30', () => {
    // An old-site sunset tour on a December evening: the cruise leaves 4:00.
    const date = '2026-12-10';
    const day = computeDay(date, [sunsetOn(date)], [], now);
    assert.equal(tourStatus(tour('late-afternoon-shared'), day, 2, { now }).bookable, false);
    assert.equal(tourStatus(tour('late-afternoon-private'), day, 2, { now }).bookable, false);
    assert.equal(tourStatus(tour('early-afternoon-shared'), day, 2, { now }).bookable, true);

    const empty = computeDay(date, [], [], now);
    assert.deepEqual(tourStatus(tour('sunset-private'), empty, 2, { now }), { bookable: false, reason: 'closed' });
  });

  test('in late March it leaves at 6:00, once the 3:30 is back and cleaned', () => {
    const date = '2027-03-25';
    const day = computeDay(date, [sunsetOn(date)], [], now);
    assert.equal(tourStatus(tour('late-afternoon-shared'), day, 2, { now }).bookable, true);
    assert.equal(tourStatus(tour('late-afternoon-private'), day, 2, { now }).bookable, true);
  });
});

describe('the 3:30 when the sunset cruise has the boat', () => {
  // November 5: the cruise leaves 4:00, so it and the 3:30 can't both run.
  const date = '2026-11-05';

  test('reads “Not available” on both sides, not “Sold out”, even while the cruise is still being paid for', () => {
    const day = computeDay(date, [{ ...sunsetOn(date), status: 'pending-payment' }], [], now);
    for (const slug of ['late-afternoon-shared', 'late-afternoon-private']) {
      const status = tourStatus(tour(slug), day, 2, { now });
      assert.deepEqual(status, { bookable: false, reason: 'taken' }, slug);
      assert.equal(statusLabel(status, tour(slug)), 'Not available', slug);
    }
  });

  test('a shared 3:30 that really is full still says “Sold out”', () => {
    const full: BookingLite = { date, timeSlot: 'late-afternoon', type: 'shared', guestCount: 6, status: 'confirmed' };
    const day = computeDay(date, [full], [], now);
    const status = tourStatus(tour('late-afternoon-shared'), day, 2, { now });
    assert.deepEqual(status, { bookable: false, reason: 'full' });
    assert.equal(statusLabel(status, tour('late-afternoon-shared')), 'Sold out');
    assert.deepEqual(tourStatus(tour('sunset-private'), day, 2, { now }), { bookable: false, reason: 'taken' });
  });

  test('so does one the fallback can’t tell about, at a departure nothing overlaps', () => {
    // The Cloud Function fallback: no seats and no private, whichever the reason.
    const day = computeDay(date, [], [], now);
    const morning = day.slots.find((s) => s.timeSlot === 'morning')!;
    Object.assign(morning, { sharedRemaining: 0, privateAvailable: false, privatelyBooked: null });
    assert.deepEqual(tourStatus(tour('morning-shared'), day, 2, { now }), { bookable: false, reason: 'full' });
  });
});

describe('departures today that online booking has closed', () => {
  // 12:15 PM: the 7:00, 8:00 and 10:30 have left, the 1:00 is inside the
  // 60-minute cutoff, and the 3:30 is still online.
  const date = '2026-10-20';
  const noon = { date, minutes: 12 * 60 + 15 };
  const day = computeDay(date, [], [], noon);

  test('one that has left reads “Already left”, not a call for same-day seats', () => {
    for (const slug of ['morning-shared', 'mid-morning-private', 'whole-day-private']) {
      const status = tourStatus(tour(slug), day, 2, { now: noon });
      assert.deepEqual(status, { bookable: false, reason: 'departed' }, slug);
      assert.equal(statusLabel(status, tour(slug)), 'Already left', slug);
    }
    // A past date, before its seats have loaded.
    assert.deepEqual(tourStatus(tour('late-afternoon-shared'), undefined, 2, { date: '2026-10-19', now: noon }), {
      bookable: false,
      reason: 'departed',
    });
  });

  test('one leaving within the hour is booked by phone, and a later one is still online', () => {
    const status = tourStatus(tour('early-afternoon-shared'), day, 2, { now: noon });
    assert.deepEqual(status, { bookable: false, reason: 'cutoff' });
    assert.equal(statusLabel(status, tour('early-afternoon-shared')), 'Call to book');
    assert.equal(tourStatus(tour('late-afternoon-shared'), day, 2, { now: noon }).bookable, true);
  });

  test('the departure time itself counts as left', () => {
    const at = { date, minutes: 13 * 60 };
    assert.equal(departureLeft(date, 'early-afternoon', at), true);
    assert.equal(departureLeft(date, 'early-afternoon', { date, minutes: 13 * 60 - 1 }), false);
    assert.equal(departureLeft('2026-10-21', 'morning', at), false);
  });
});

describe('seasonWords', () => {
  test('says the cruise’s season from SLOT_SEASONS, and nothing for a departure that runs all year', () => {
    assert.equal(seasonWords('sunset'), 'April 1 – November 14');
    assert.equal(seasonWords('morning'), null);
  });
});

describe('the statuses /api/availability reads', () => {
  test('are all the seats depend on: other bookings change nothing', () => {
    // The route asks Firestore only for ACTIVE_STATUSES (src/lib/availability-server.ts).
    const date = '2026-10-24';
    const on = (timeSlot: BookingLite['timeSlot'], type: BookingLite['type'], status: string): BookingLite => ({
      date,
      timeSlot,
      type,
      guestCount: 2,
      status,
    });
    const everything = [
      on('morning', 'shared', 'confirmed'),
      on('morning', 'private', 'cancelled'),
      on('mid-morning', 'private', 'completed'),
      on('early-afternoon', 'shared', 'no-show'),
      on('late-afternoon', 'shared', 'pending-payment'),
      on('whole-day', 'private', 'cancelled'),
      on('sunset', 'private', 'completed'),
    ];
    const read = everything.filter((b) => ACTIVE_STATUSES.has(b.status));
    assert.equal(read.length, 2);
    assert.deepEqual(computeRange(date, date, read, [], now), computeRange(date, date, everything, [], now));
  });
});

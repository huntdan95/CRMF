/**
 * The booking calendar's seat rules (src/lib/availability.ts), which mirror
 * the Cloud Function's. Run with `npm test`.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { computeDay, tourStatus, type BookingLite } from '../src/lib/availability';
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

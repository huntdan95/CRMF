/**
 * The booking calendar's fallback when /api/availability can't be reached
 * (src/components/booking/useAvailability.ts). Run with `npm test`.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { fromFunctionSlots } from '../src/components/booking/useAvailability';

// A January weekday: the sunset cruise isn't running.
const DATE = '2027-01-12';

function slot(
  timeSlot: string,
  over: Partial<{ sharedRemaining: number; privateAvailable: boolean; blackedOut: boolean; hasBookings: boolean }> = {},
) {
  return { timeSlot, sharedRemaining: 6, privateAvailable: true, blackedOut: false, wholeDayBooked: false, ...over };
}

function wholeDay(slots: ReturnType<typeof slot>[]) {
  return fromFunctionSlots(DATE, slots)!.slots.find((s) => s.timeSlot === 'whole-day')!;
}

describe('fromFunctionSlots', () => {
  const blackedOut = { sharedRemaining: 0, privateAvailable: false, blackedOut: true };

  test('a late-afternoon blackout leaves the whole-day charter open', () => {
    const day = wholeDay([
      slot('morning', { hasBookings: false }),
      slot('mid-morning', { hasBookings: false }),
      slot('early-afternoon', { hasBookings: false }),
      slot('late-afternoon', { ...blackedOut, hasBookings: false }),
      slot('whole-day', { hasBookings: false }),
    ]);
    assert.equal(day.closed, false);
    assert.equal(day.privateAvailable, true);
  });

  test('not when the blacked-out departure still has bookings on it', () => {
    // Travis closed it and kept them booked, or they're still choosing.
    const day = wholeDay([
      slot('morning', { hasBookings: false }),
      slot('mid-morning', { hasBookings: false }),
      slot('early-afternoon', { hasBookings: false }),
      slot('late-afternoon', { ...blackedOut, hasBookings: true }),
      slot('whole-day', { hasBookings: false }),
    ]);
    assert.equal(day.privateAvailable, false);
  });

  test('a function that does not say counts the blackout as booked', () => {
    const day = wholeDay([
      slot('morning'),
      slot('mid-morning'),
      slot('early-afternoon'),
      slot('late-afternoon', blackedOut),
      slot('whole-day'),
    ]);
    assert.equal(day.privateAvailable, false);
  });

  test('the sunset cruise out of season is not a booking', () => {
    // January: it isn't running, so the function shows no seats on it.
    const day = wholeDay([
      slot('morning'),
      slot('mid-morning'),
      slot('early-afternoon'),
      slot('late-afternoon'),
      slot('sunset', { sharedRemaining: 0, privateAvailable: false }),
      slot('whole-day'),
    ]);
    assert.equal(day.privateAvailable, true);
  });

  test('a booking on any departure still rules the charter out', () => {
    const day = wholeDay([
      slot('morning'),
      slot('mid-morning'),
      slot('early-afternoon'),
      slot('late-afternoon', { sharedRemaining: 4, privateAvailable: false }),
      slot('whole-day'),
    ]);
    assert.equal(day.privateAvailable, false);
  });
});

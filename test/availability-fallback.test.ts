/**
 * The booking calendar's fallback when /api/availability can't be reached
 * (src/components/booking/useAvailability.ts). Run with `npm test`.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { fromFunctionSlots } from '../src/components/booking/useAvailability';

// A January weekday: the sunset cruise isn't running.
const DATE = '2027-01-12';

function slot(timeSlot: string, over: Partial<{ sharedRemaining: number; privateAvailable: boolean; blackedOut: boolean }> = {}) {
  return { timeSlot, sharedRemaining: 6, privateAvailable: true, blackedOut: false, wholeDayBooked: false, ...over };
}

function wholeDay(slots: ReturnType<typeof slot>[]) {
  return fromFunctionSlots(DATE, slots)!.slots.find((s) => s.timeSlot === 'whole-day')!;
}

describe('fromFunctionSlots', () => {
  test('a late-afternoon blackout leaves the whole-day charter open', () => {
    const day = wholeDay([
      slot('morning'),
      slot('mid-morning'),
      slot('early-afternoon'),
      slot('late-afternoon', { sharedRemaining: 0, privateAvailable: false, blackedOut: true }),
      slot('whole-day'),
    ]);
    assert.equal(day.closed, false);
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

/**
 * Departure times, including the sunset cruise's, which moves with the
 * sun, and the seasonal and turnaround rules. Run with `npm test` in
 * functions/.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { slotConflicts, slotRunsOn, slotStartTime, sunsetMinutes } from '../src/lib/schedule';

const clock = (mins: number) => `${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, '0')}`;

describe('sunsetMinutes', () => {
  // Published sunset times for Crystal River, FL, to within two minutes.
  for (const [date, expected] of [
    ['2026-04-01', '19:48'],
    ['2026-06-21', '20:31'],
    ['2026-10-31', '18:46'],
    ['2026-11-01', '17:45'], // daylight saving ends
    ['2026-11-14', '17:37'],
  ] as const) {
    test(`${date} is about ${expected}`, () => {
      const [h, m] = expected.split(':').map(Number) as [number, number];
      assert.ok(Math.abs(sunsetMinutes(date) - (h * 60 + m)) <= 2, `got ${clock(sunsetMinutes(date))}`);
    });
  }
});

describe('slotStartTime', () => {
  test('fixed departures leave at the same time every day', () => {
    assert.equal(slotStartTime('morning', '2026-04-01'), '08:00');
    assert.equal(slotStartTime('late-afternoon', '2026-11-14'), '15:30');
    assert.equal(slotStartTime('whole-day', '2026-07-04'), '07:00');
  });

  test('the sunset cruise leaves 90 minutes before sunset, rounded down to the quarter hour', () => {
    assert.equal(slotStartTime('sunset', '2026-04-01'), '18:15'); // sunset ~7:48
    assert.equal(slotStartTime('sunset', '2026-06-21'), '19:00'); // sunset ~8:31
    assert.equal(slotStartTime('sunset', '2026-11-14'), '16:00'); // sunset ~5:37
  });
});

describe('slotRunsOn', () => {
  test('the sunset cruise runs April 1 through November 14', () => {
    assert.equal(slotRunsOn('sunset', '2026-03-31'), false);
    assert.equal(slotRunsOn('sunset', '2026-04-01'), true);
    assert.equal(slotRunsOn('sunset', '2026-11-14'), true);
    assert.equal(slotRunsOn('sunset', '2026-11-15'), false);
    assert.equal(slotRunsOn('sunset', '2027-01-10'), false);
  });

  test('every other departure runs all year', () => {
    assert.equal(slotRunsOn('morning', '2027-01-10'), true);
    assert.equal(slotRunsOn('whole-day', '2026-12-25'), true);
  });
});

describe('slotConflicts', () => {
  test('the two-hour slots never conflict: each leaves 30 minutes after the last is back', () => {
    for (const slot of ['morning', 'mid-morning', 'early-afternoon', 'late-afternoon'] as const) {
      assert.deepEqual(slotConflicts(slot, '2027-01-10'), [], slot);
    }
  });

  test('in spring and summer the sunset cruise leaves after the 3:30 tour is back and cleaned', () => {
    assert.deepEqual(slotConflicts('sunset', '2026-04-01'), []);
    assert.deepEqual(slotConflicts('late-afternoon', '2026-06-21'), []);
    assert.deepEqual(slotConflicts('sunset', '2026-09-15'), []); // leaves 6:00, 3:30 tour cleaned by 6:00
  });

  test('from late September the sunset cruise and the 3:30 tour take the same boat', () => {
    assert.deepEqual(slotConflicts('sunset', '2026-10-01'), ['late-afternoon']);
    assert.deepEqual(slotConflicts('late-afternoon', '2026-10-01'), ['sunset']);
    assert.deepEqual(slotConflicts('late-afternoon', '2026-11-14'), ['sunset']);
  });

  test('out of season the 3:30 tour has nothing to conflict with', () => {
    assert.deepEqual(slotConflicts('late-afternoon', '2026-11-20'), []);
  });

  test('the whole-day charter has its own rule', () => {
    assert.deepEqual(slotConflicts('whole-day', '2026-10-01'), []);
  });
});

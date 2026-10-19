/**
 * Mapping old-site bookings onto the new tours (scripts/import-legacy-bookings.ts).
 * Run with `npm test`.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Timestamp } from 'firebase-admin/firestore';

import { mapRows } from '../scripts/import-legacy-bookings';

const TODAY = '2026-10-19';

function row(tour: string, startTime: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    booking_id: '101',
    booking_status: 'confirmed',
    tour,
    tour_date: '2026-10-24',
    start_time: startTime,
    persons: '4',
    customer_name: 'Jane Smith',
    email: 'jane@example.com',
    phone: '352-555-0100',
    order_ids: '9001',
    amount_paid: '400.00',
    refunded: '0',
    ...extra,
  };
}

function mapOne(r: Record<string, string>) {
  const { mapped, skipped } = mapRows([r], TODAY, Timestamp.fromDate(new Date('2026-10-19T12:00:00Z')));
  assert.deepEqual(skipped, []);
  return mapped[0]!.data;
}

describe('mapRows', () => {
  test('a sunset tour holds the sunset cruise, not the late-afternoon slot', () => {
    const b = mapOne(row('2hr Sunset Tour - Private', '17:00'));
    assert.equal(b.timeSlot, 'sunset');
    assert.equal(b.tourId, 'sunset-private');
    assert.equal(b.type, 'private');
    assert.equal(b.tourName, '2hr Sunset Tour - Private');
  });

  test('a standard afternoon tour still maps by start time', () => {
    const b = mapOne(row('2hr Afternoon Tour - Shared', '15:30'));
    assert.equal(b.timeSlot, 'late-afternoon');
    assert.equal(b.tourId, 'late-afternoon-shared');
  });

  test('the whole-day charter maps by name', () => {
    const b = mapOne(row('Whole Day Tour - Private', '07:00'));
    assert.equal(b.tourId, 'whole-day-private');
  });
});

/**
 * Mapping old-site bookings onto the new tours (scripts/import-legacy-bookings.ts).
 * Run with `npm test`.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Timestamp } from 'firebase-admin/firestore';

import { mapRows, seatConflicts } from '../scripts/import-legacy-bookings';

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

  test('a sunset tour out of the cruise’s season holds the departure it overlaps', () => {
    // The sunset cruise doesn't run Nov 15 – Mar 31, so a booking on it
    // there would block nothing.
    const b = mapOne(row('2hr Sunset Tour - Shared', '17:00', { tour_date: '2026-11-20' }));
    assert.equal(b.timeSlot, 'late-afternoon');
    assert.equal(b.tourId, 'late-afternoon-private');
    assert.equal(b.tourName, '2hr Sunset Tour - Shared');
    assert.match(String(b.adminNotes), /Old-site sunset tour at 5:00 PM/);
  });

  test('an old "pending payment" with nothing paid is cancelled; one with a deposit is a reservation', () => {
    const unpaid = mapOne(row('2hr Morning Tour - Shared', '08:00', { booking_status: 'pending payment', amount_paid: '0' }));
    assert.equal(unpaid.status, 'cancelled');
    assert.equal(unpaid.cancellationReason, 'Not paid on the old site');

    const deposit = mapOne(row('2hr Morning Tour - Private', '08:00', { booking_status: 'pending payment', amount_paid: '100' }));
    assert.equal(deposit.status, 'pending-payment');
    assert.equal(deposit.cancellationReason, null);
    assert.match(String(deposit.adminNotes), /\$100\.00 paid so far/);
  });
});

describe('seatConflicts', () => {
  const at = Timestamp.fromDate(new Date('2026-10-19T12:00:00Z'));
  const conflicts = (...rows: Record<string, string>[]) =>
    seatConflicts(mapRows(rows.map((r, i) => ({ ...r, booking_id: String(201 + i) })), TODAY, at).mapped);

  test('the sunset cruise and the 3:30 on a late-season evening clash', () => {
    const lines = conflicts(row('2hr Sunset Tour - Private', '17:00'), row('2hr Afternoon Tour - Shared', '15:30'));
    assert.deepEqual(lines, ['2026-10-24: late-afternoon and sunset overlap: legacy-201, legacy-202']);
  });

  test('the whole-day charter clashes with anything else that day', () => {
    const lines = conflicts(row('Whole Day Tour - Private', '07:00'), row('2hr Afternoon Tour - Shared', '15:30'));
    assert.equal(lines.length, 1);
    assert.match(lines[0]!, /whole-day charter plus other bookings/);
  });

  test('separate departures that don’t overlap are fine', () => {
    assert.deepEqual(conflicts(row('2hr Morning Tour - Private', '08:00'), row('2hr Afternoon Tour - Private', '15:30')), []);
  });
});

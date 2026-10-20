/**
 * Mapping old-site bookings onto the new tours (scripts/import-legacy-bookings.ts).
 * Run with `npm test`.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';

import { mapRows, resyncChanges, resyncFields, seatConflicts } from '../scripts/import-legacy-bookings';

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

  test('a sunset tour out of the cruise’s season still goes on the sunset cruise', () => {
    // Not sold online Nov 15 – Mar 31, but the calendar still counts it
    // against the departures it overlaps, at its real time.
    const b = mapOne(row('2hr Sunset Tour - Shared', '16:00', { tour_date: '2026-12-10' }));
    assert.equal(b.timeSlot, 'sunset');
    assert.equal(b.tourId, 'sunset-private');
    assert.equal(b.tourName, '2hr Sunset Tour - Shared');
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

  test('so do they out of season, on a December evening', () => {
    const december = { tour_date: '2026-12-10' };
    const lines = conflicts(row('2hr Sunset Tour - Private', '16:00', december), row('2hr Afternoon Tour - Shared', '15:30', december));
    assert.deepEqual(lines, ['2026-12-10: late-afternoon and sunset overlap: legacy-201, legacy-202']);
  });

  test('but not in late March, when the sunset cruise leaves at 6:00', () => {
    const march = { tour_date: '2027-03-25' };
    assert.deepEqual(conflicts(row('2hr Sunset Tour - Private', '18:00', march), row('2hr Afternoon Tour - Shared', '15:30', march)), []);
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

describe('resyncFields', () => {
  const at = Timestamp.fromDate(new Date('2026-10-19T12:00:00Z'));
  const mapped = (r: Record<string, string>) => mapRows([r], TODAY, at).mapped[0]!;
  const isDelete = (v: unknown) => v instanceof FieldValue && v.isEqual(FieldValue.delete());
  const cancelledHere = { status: 'cancelled', date: '2026-10-24', timeSlot: 'late-afternoon', manualRefundCents: 40000 };

  test('owes back by hand no more than the CSV leaves unrefunded', () => {
    const csv = (refunded: string) => mapped(row('2hr Afternoon Tour - Shared', '15:30', { booking_status: 'cancelled', refunded }));
    // Refunded in full on the old site: nothing left to refund by hand.
    assert.equal(resyncFields(csv('400.00'), cancelledHere).manualRefundCents, null);
    assert.equal(resyncFields(csv('150.00'), cancelledHere).manualRefundCents, 25000);
    // Nothing refunded there: what the new admin recorded stands.
    assert.equal('manualRefundCents' in resyncFields(csv('0'), cancelledHere), false);
  });

  test('billing details aren’t imported, and a re-sync takes off ones an earlier import kept', () => {
    const csv = mapped(row('2hr Afternoon Tour - Shared', '15:30', { city: 'Ocala', state: 'FL', zip: '34470', country: 'US' }));
    assert.equal('billing' in (csv.data.legacy as Record<string, unknown>), false);
    const fields = resyncFields(csv, { ...cancelledHere, status: 'confirmed', legacy: { bookingId: 101, billing: { city: 'Ocala', zip: '34470' } } });
    assert.ok(isDelete((fields.legacy as Record<string, unknown>).billing));
    assert.equal((fields.legacy as Record<string, unknown>).bookingId, 101);
    // Nothing to take off a doc that never had them.
    assert.equal('billing' in (resyncFields(csv, cancelledHere).legacy as Record<string, unknown>), false);
  });

  test('a booking the CSV puts back loses the closure that cancelled it', () => {
    const csv = mapped(row('2hr Afternoon Tour - Shared', '15:30'));
    const fields = resyncFields(csv, { ...cancelledHere, closure: { blackoutId: 'b1', reason: 'Weather', decideBy: '2026-10-27' } });
    assert.equal(fields.status, 'confirmed');
    assert.equal(fields.manualRefundCents, null);
    assert.ok(isDelete(fields.closure));
  });

  test('a live closure stays, unless the old site moved the booking', () => {
    const closure = { blackoutId: 'b1', reason: 'Weather', decideBy: '2026-10-27' };
    const waiting = { status: 'confirmed', date: '2026-10-24', timeSlot: 'late-afternoon', closure };
    assert.equal('closure' in resyncFields(mapped(row('2hr Afternoon Tour - Shared', '15:30')), waiting), false);
    const moved = mapped(row('2hr Afternoon Tour - Shared', '15:30', { tour_date: '2026-10-31' }));
    assert.ok(isDelete(resyncFields(moved, waiting).closure));
  });

  test('a booking erased in the new admin doesn’t get its customer back from the CSV', () => {
    const csv = mapped(row('2hr Afternoon Tour - Shared', '15:30', { booking_status: 'cancelled' }));
    const erased = { ...cancelledHere, customerName: '', customerEmail: '', customerPhone: '', erasedAt: at };
    const fields = resyncFields(csv, erased);
    for (const key of ['customerName', 'customerEmail', 'customerPhone']) assert.equal(key in fields, false, key);
    // None of what else the erase blanks is in what the re-sync writes.
    for (const key of ['emergencyContactName', 'emergencyContactPhone', 'guests', 'adminNotes']) assert.equal(key in fields, false, key);
    assert.equal('billing' in (fields.legacy as Record<string, unknown>), false);
    // The old site's side of it still comes in.
    assert.equal(fields.status, 'cancelled');
    assert.equal(fields.cancellationReason, 'Cancelled on the old site');
    // One that wasn't erased gets them as before.
    assert.equal(resyncFields(csv, cancelledHere).customerEmail, 'jane@example.com');
  });
});

describe('resyncChanges (what --update-existing --dry-run lists)', () => {
  const at = Timestamp.fromDate(new Date('2026-10-19T12:00:00Z'));
  const mapped = (r: Record<string, string>) => mapRows([r], TODAY, at).mapped[0]!;
  const afternoon = { date: '2026-10-24', timeSlot: 'late-afternoon', tourId: 'late-afternoon-shared' };

  test('a booking cancelled in the new admin that the old site still has is put back, and its refund owed dropped', () => {
    const current = { ...afternoon, status: 'cancelled', manualRefundCents: 15000, manualRefundedAt: at };
    assert.deepEqual(resyncChanges(mapped(row('2hr Afternoon Tour - Shared', '15:30')), current), [
      'status cancelled → confirmed',
      'owed back by hand $150.00 → none',
      'Refunded by hand → cleared',
    ]);
  });

  test('a booking moved in the new admin goes back to the old site’s departure', () => {
    const current = { status: 'confirmed', date: '2026-10-31', timeSlot: 'morning', tourId: 'morning-shared' };
    assert.deepEqual(resyncChanges(mapped(row('2hr Afternoon Tour - Shared', '15:30')), current), [
      'date 2026-10-31 → 2026-10-24',
      'slot morning → late-afternoon',
      'tour morning-shared → late-afternoon-shared',
    ]);
  });

  test('cancelled in both, only a cut to the money owed back is listed', () => {
    const current = { ...afternoon, status: 'cancelled', manualRefundCents: 40000 };
    const csv = (refunded: string) => mapped(row('2hr Afternoon Tour - Shared', '15:30', { booking_status: 'cancelled', refunded }));
    assert.deepEqual(resyncChanges(csv('150.00'), current), ['owed back by hand $400.00 → $250.00']);
    assert.deepEqual(resyncChanges(csv('0'), current), []);
  });

  test('a booking both sites agree on isn’t listed', () => {
    assert.deepEqual(resyncChanges(mapped(row('2hr Afternoon Tour - Shared', '15:30')), { ...afternoon, status: 'confirmed' }), []);
  });

  test('an erased booking is listed, to say its details stay blank', () => {
    const past = mapped(row('2hr Afternoon Tour - Shared', '15:30', { tour_date: '2026-10-10' }));
    const current = { ...afternoon, date: '2026-10-10', status: 'completed', customerName: '', customerEmail: '', customerPhone: '', erasedAt: at };
    assert.deepEqual(resyncChanges(past, current), ['erased: contact details left blank']);
  });
});

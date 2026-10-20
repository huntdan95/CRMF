/**
 * Mapping old-site bookings onto the new tours (scripts/import-legacy-bookings.ts).
 * Run with `npm test`.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';

import {
  mapRows,
  movedChanges,
  movedOnBothSites,
  resyncChanges,
  resyncFields,
  seatConflicts,
} from '../scripts/import-legacy-bookings';

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
  // As the first import left it, from row()'s party and contact details.
  const asImported = {
    guestCount: 4,
    customerName: 'Jane Smith',
    customerEmail: 'jane@example.com',
    customerPhone: '352-555-0100',
    legacy: { bookingId: 101, persons: '4' },
  };
  const afternoon = { date: '2026-10-24', timeSlot: 'late-afternoon', tourId: 'late-afternoon-shared', ...asImported };

  test('a booking cancelled in the new admin that the old site still has is put back, and its refund owed dropped', () => {
    const current = { ...afternoon, status: 'cancelled', manualRefundCents: 15000, manualRefundedAt: at };
    assert.deepEqual(resyncChanges(mapped(row('2hr Afternoon Tour - Shared', '15:30')), current), [
      'status cancelled → confirmed',
      'owed back by hand $150.00 → none',
      'Refunded by hand → cleared',
    ]);
  });

  test('a booking moved in the new admin goes back to the old site’s departure', () => {
    const current = { status: 'confirmed', date: '2026-10-31', timeSlot: 'morning', tourId: 'morning-shared', ...asImported };
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

describe('a party size or contact detail changed in the new admin', () => {
  const at = Timestamp.fromDate(new Date('2026-10-19T12:00:00Z'));
  const csv = (extra: Record<string, string>) => mapRows([row('2hr Afternoon Tour - Shared', '15:30', extra)], TODAY, at).mapped[0]!;
  // Imported from a row with a party of 2.
  const doc = (changes: Record<string, unknown>) => ({
    status: 'confirmed',
    date: '2026-10-24',
    timeSlot: 'late-afternoon',
    tourId: 'late-afternoon-shared',
    guestCount: 2,
    customerName: 'Jane Smith',
    customerEmail: 'jane@example.com',
    customerPhone: '352-555-0100',
    legacy: { bookingId: 101, persons: '2' },
    ...changes,
  });

  test('a party size raised here stays when the old site still has the old one, and is listed', () => {
    const current = doc({ guestCount: 4 });
    assert.equal('guestCount' in resyncFields(csv({ persons: '2' }), current), false);
    assert.deepEqual(resyncChanges(csv({ persons: '2' }), current), ['party size 4 kept (CSV 2)']);
  });

  test('a blank party size on the old site never replaces a known one', () => {
    // Imported with none; Travis recorded 3 guests.
    const current = doc({ guestCount: 3, legacy: { bookingId: 101, persons: null } });
    assert.equal('guestCount' in resyncFields(csv({ persons: '' }), current), false);
    assert.deepEqual(resyncChanges(csv({ persons: '' }), current), ['party size 3 kept (CSV blank)']);
  });

  test('the old site’s own change comes in; changed on both sites, the old site’s goes in and it says so', () => {
    assert.equal(resyncFields(csv({ persons: '3' }), doc({})).guestCount, 3);
    assert.deepEqual(resyncChanges(csv({ persons: '3' }), doc({})), ['party size 2 → 3']);
    const both = doc({ guestCount: 4 });
    assert.equal(resyncFields(csv({ persons: '5' }), both).guestCount, 5);
    assert.deepEqual(resyncChanges(csv({ persons: '5' }), both), ['party size 4 → 5 (changed here and on the old site)']);
  });

  test('an address fixed here stays, though the CSV still has the bounced one', () => {
    const fixed = [{ before: { customerEmail: 'jane@example.com' }, after: { customerEmail: 'jane.smith@example.com' } }];
    const current = doc({ customerEmail: 'jane.smith@example.com' });
    assert.equal('customerEmail' in resyncFields(csv({ persons: '2' }), current, fixed), false);
    assert.deepEqual(resyncChanges(csv({ persons: '2' }), current, fixed), ['email kept (changed here)']);
  });

  test('a contact detail changed on the old site comes in, and is listed without the detail', () => {
    const m = csv({ persons: '2', email: 'Jane.S@example.com', phone: '352-555-0199' });
    const fields = resyncFields(m, doc({}));
    assert.equal(fields.customerEmail, 'jane.s@example.com');
    assert.equal(fields.customerPhone, '352-555-0199');
    const lines = resyncChanges(m, doc({}));
    assert.deepEqual(lines, ['email updated from the old site', 'phone updated from the old site']);
    assert.doesNotMatch(lines.join(' '), /@|555/);
  });

  test('a phone changed twice here stays; changed on the old site too, the old site’s goes in', () => {
    const edits = [
      { before: { customerPhone: '352-555-0100' }, after: { customerPhone: '352-555-0111', customerName: 'Jane Smith' } },
      { before: { customerPhone: '352-555-0111' }, after: { customerPhone: '352-555-0122' } },
    ];
    const current = doc({ customerPhone: '352-555-0122' });
    assert.equal('customerPhone' in resyncFields(csv({ persons: '2' }), current, edits), false);
    assert.deepEqual(resyncChanges(csv({ persons: '2' }), current, edits), ['phone kept (changed here)']);
    const both = csv({ persons: '2', phone: '352-555-0199' });
    assert.equal(resyncFields(both, current, edits).customerPhone, '352-555-0199');
    assert.deepEqual(resyncChanges(both, current, edits), ['phone changed here and on the old site: the old site’s goes in']);
  });

  test('an edit something since put back isn’t taken for a change made here', () => {
    // Travis corrected the name; an earlier re-sync put the old site's back,
    // and the old site has since changed it itself.
    const edits = [{ before: { customerName: 'Jane Smith' }, after: { customerName: 'Jane Smyth' } }];
    const m = csv({ persons: '2', customer_name: 'Janet Smith' });
    assert.equal(resyncFields(m, doc({}), edits).customerName, 'Janet Smith');
    assert.deepEqual(resyncChanges(m, doc({}), edits), ['name updated from the old site']);
  });
});

describe('movedOnBothSites (a move made here, then with Reschedule on the old site)', () => {
  const at = Timestamp.fromDate(new Date('2026-10-19T12:00:00Z'));
  // Old-site #101 rescheduled, on its order 9001, to a new #102 on Oct 31's morning tour.
  const rows = [
    row('2hr Afternoon Tour - Shared', '15:30', { booking_status: 'rescheduled' }),
    row('2hr Morning Tour - Shared', '08:00', { booking_id: '102', tour_date: '2026-10-31' }),
  ];
  const { mapped } = mapRows(rows, TODAY, at);
  // legacy-101 as the new admin moved it.
  const movedHere = { status: 'confirmed', date: '2026-10-31', timeSlot: 'morning', tourId: 'morning-shared', legacy: { bookingId: 101, persons: '4' } };

  test('the CSV names where the rescheduled booking went', () => {
    assert.deepEqual(mapped[0]!.movedTo, ['102']);
    assert.equal(mapped[0]!.data.cancellationReason, 'Rescheduled on the old site (moved to booking #102)');
  });

  test('legacy-101, already on #102’s departure, is kept as one booking and #102 isn’t imported', () => {
    const moved = movedOnBothSites(mapped, new Map([['legacy-101', movedHere]]));
    assert.deepEqual([...moved.keys()], ['legacy-101']);
    assert.equal(moved.get('legacy-101')!.id, 'legacy-102');
    assert.deepEqual(movedChanges(moved.get('legacy-101')!, movedHere), ['moved here and on the old site (#102): kept as one booking']);
  });

  test('a reschedule made only on the old site still goes through as before', () => {
    const notMovedHere = { ...movedHere, date: '2026-10-24', timeSlot: 'late-afternoon', tourId: 'late-afternoon-shared' };
    assert.equal(movedOnBothSites(mapped, new Map([['legacy-101', notMovedHere]])).size, 0);
    // Nor when #102 was imported before.
    const both = new Map<string, Record<string, unknown>>([['legacy-101', movedHere], ['legacy-102', { status: 'confirmed' }]]);
    assert.equal(movedOnBothSites(mapped, both).size, 0);
  });

  test('once linked, it stays one booking after #102 changes on the old site, and the change is listed, not copied', () => {
    const later = mapRows([rows[0]!, { ...rows[1]!, booking_status: 'cancelled' }], TODAY, at).mapped;
    const linked = { ...movedHere, legacy: { ...movedHere.legacy, oldSiteMovedTo: 102 } };
    const moved = movedOnBothSites(later, new Map([['legacy-101', linked]]));
    assert.equal(moved.get('legacy-101')?.id, 'legacy-102');
    assert.deepEqual(movedChanges(moved.get('legacy-101')!, linked), [
      'moved here and on the old site (#102): kept as one booking',
      '#102 differs, not copied: status confirmed → cancelled',
    ]);
  });
});

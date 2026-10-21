/**
 * Which cancelled bookings the one-off backfill fills in
 * (scripts/backfill-manual-refunds.ts). Run with `npm test`.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  adminBase,
  adminBookingUrl,
  backfillChange,
  DEFAULT_ADMIN_BASE,
  stillOwedByHand,
  type BackfillBooking,
} from '../scripts/backfill-manual-refunds';

const NOTE = '2026-10-02: Cancelled. $200.00 was paid on the old website. Refund it by hand.';

function legacy(extra: Partial<BackfillBooking> = {}): BackfillBooking {
  return {
    id: 'legacy-4410',
    legacy: { bookingId: '4410' },
    status: 'cancelled',
    amountPaidCents: 20000,
    amountRefundedCents: 0,
    adminNotes: NOTE,
    cancellationReason: null,
    ...extra,
  };
}

describe('backfillChange', () => {
  test('an old-site booking cancelled here with the refund-by-hand note owes back what was paid and not refunded', () => {
    assert.deepEqual(backfillChange(legacy({ amountRefundedCents: 5000 }), []), { manualRefundCents: 15000 });
  });

  test('the cancel entry in the audit log is evidence enough without the note', () => {
    const b = legacy({ adminNotes: undefined });
    assert.deepEqual(backfillChange(b, [{ manualRefundCents: 20000, emailed: false, reason: null }]), {
      manualRefundCents: 20000,
    });
    assert.equal(backfillChange(b, [{ manualRefundCents: 0, emailed: false, reason: null }]), null);
  });

  test('an import that came over already cancelled, with no note or entry, is left alone', () => {
    assert.equal(backfillChange(legacy({ adminNotes: 'Rescheduled on the old site' }), []), null);
  });

  test('nothing owed, a booking from this site, or one not cancelled: no money change', () => {
    assert.equal(backfillChange(legacy({ amountRefundedCents: 20000 }), []), null);
    assert.equal(backfillChange(legacy({ amountPaidCents: 0 }), []), null);
    assert.equal(backfillChange(legacy({ id: 'bk_1', legacy: undefined }), []), null);
    assert.equal(backfillChange(legacy({ status: 'confirmed' }), []), null);
  });

  test('a booking that already has the fields is left alone, so a second run changes nothing', () => {
    const entry = { manualRefundCents: 20000, emailed: false, reason: 'Called to cancel' };
    const once = legacy({ cancellationReason: 'Called to cancel' });
    const change = backfillChange(once, [entry]);
    assert.deepEqual(change, { manualRefundCents: 20000, cancellationReasonPrivate: true });
    assert.equal(backfillChange({ ...once, ...change }, [entry]), null);
  });

  test('a reason Travis typed while cancelling without an email becomes private', () => {
    const b: BackfillBooking = {
      id: 'bk_2',
      status: 'cancelled',
      amountPaidCents: 0,
      amountRefundedCents: 0,
      cancellationReason: 'Double booked by mistake',
    };
    assert.deepEqual(backfillChange(b, [{ emailed: false, reason: 'Double booked by mistake' }]), {
      cancellationReasonPrivate: true,
    });
    // Emailed: the customer was sent it anyway.
    assert.equal(backfillChange(b, [{ emailed: true, reason: 'Double booked by mistake' }]), null);
    // Not his reason any more (a closure's, or a re-sync's).
    assert.equal(backfillChange({ ...b, cancellationReason: 'Closed for weather' }, [{ emailed: false, reason: 'Double booked by mistake' }]), null);
    // No reason typed.
    assert.equal(backfillChange({ ...b, cancellationReason: null }, [{ emailed: false, reason: null }]), null);
  });
});

describe('stillOwedByHand', () => {
  test('lists what this run wrote and what an earlier run did, until Travis records it refunded', () => {
    const b = legacy();
    assert.equal(stillOwedByHand(b, backfillChange(b, [])), 20000);
    // Not written (it changed meanwhile): nothing on the booking yet.
    assert.equal(stillOwedByHand(b, null), 0);
    // Written by an earlier run.
    assert.equal(stillOwedByHand(legacy({ manualRefundCents: 20000 }), null), 20000);
    // He tapped “Refunded by hand”.
    assert.equal(stillOwedByHand(legacy({ manualRefundCents: 20000, manualRefundedAt: { seconds: 1 } }), null), 0);
    assert.equal(stillOwedByHand(legacy({ status: 'confirmed', manualRefundCents: 20000 }), null), 0);
  });
});

describe('the "Refunded by hand" links', () => {
  test('open the App Hosting address, not the domain that still serves the old site, unless --base says otherwise', () => {
    assert.equal(adminBase(['--apply']), DEFAULT_ADMIN_BASE);
    assert.ok(DEFAULT_ADMIN_BASE.endsWith('.hosted.app'));
    assert.equal(adminBase(['--apply', '--base', 'https://crystalrivermanateefun.com/']), 'https://crystalrivermanateefun.com');
    assert.equal(
      adminBookingUrl(DEFAULT_ADMIN_BASE, 'legacy-4410'),
      'https://default--crmf-99aad.us-east4.hosted.app/admin/bookings/legacy-4410',
    );
  });

  test('a --base without an address stops the run', () => {
    assert.throws(() => adminBase(['--base']));
    assert.throws(() => adminBase(['--base', '--apply']));
    assert.throws(() => adminBase(['--base', 'crystalrivermanateefun.com']));
  });
});

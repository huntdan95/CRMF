/**
 * Which booking changes push a notification to Travis's admin app. Run
 * with `npm test` in functions/.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { bookingPushes } from '../src/adminNotifications';
import type { Booking } from '../src/lib/types';

const base = {
  tourId: 'morning-shared',
  tourName: '2hr Morning Tour — Shared',
  date: '2026-11-14',
  timeSlot: 'morning',
  type: 'shared',
  guestCount: 4,
  customerName: 'Jane Smith',
  customerEmail: 'jane@example.com',
  status: 'pending-payment',
  amountPaidCents: 0,
  amountRefundedCents: 0,
} as unknown as Booking;

const paid = { ...base, status: 'confirmed', amountPaidCents: 33600 } as Booking;

describe('bookingPushes', () => {
  test('a booking that was just paid for', () => {
    const [push, ...rest] = bookingPushes('b1', base, paid);
    assert.equal(rest.length, 0);
    assert.equal(push!.title, 'New booking: Sat Nov 14, 8:00 AM shared');
    assert.equal(push!.body, 'Jane Smith · 4 guests · $336');
    assert.equal(push!.url, '/admin/bookings/b1');
  });

  test('nothing for an old-site import, an edit, or a booking already confirmed', () => {
    assert.deepEqual(bookingPushes('legacy-9', undefined, paid), []);
    assert.deepEqual(bookingPushes('b1', paid, { ...paid, guestCount: 5 } as Booking), []);
    assert.deepEqual(bookingPushes('b1', paid, undefined), []);
  });

  test('a customer cancellation, with the refund; not Travis’s own', () => {
    const cancelled = { ...paid, status: 'cancelled', cancelledBy: 'customer', amountRefundedCents: 33600 } as Booking;
    const [push] = bookingPushes('b1', paid, cancelled);
    assert.equal(push!.title, 'Cancelled: Sat Nov 14, 8:00 AM shared');
    assert.equal(push!.body, 'Jane Smith · 4 guests · $336 refunded');
    assert.deepEqual(bookingPushes('b1', paid, { ...cancelled, cancelledBy: 'admin' } as Booking), []);
  });

  test('a bounce alert, once per kind of email', () => {
    const at = { toMillis: () => 0 } as unknown as FirebaseFirestore.Timestamp;
    const alerted = { ...paid, bounceAlertSentAt: { confirmation: at } } as Booking;
    const [push] = bookingPushes('b1', paid, alerted);
    assert.equal(push!.title, 'Email bounced: call Jane Smith');
    assert.match(push!.body, /booking confirmation didn’t arrive \(jane@example\.com\)/);
    assert.deepEqual(bookingPushes('b1', alerted, { ...alerted, guestCount: 3 } as Booking), []);
  });
});

/**
 * Which booking changes push a notification to Travis's admin app. Run
 * with `npm test` in functions/.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { bookingPushes, reviewListPush } from '../src/adminNotifications';
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

  test('a cancellation’s refund is its own, not Travis’s earlier refunds as well', () => {
    // Travis gave $40 back when a guest dropped; cancelling inside 72 hours refunds nothing more.
    const partly = { ...paid, amountRefundedCents: 4000 } as Booking;
    const cancelled = { ...partly, status: 'cancelled', cancelledBy: 'customer', cancelRefundCents: 0 } as Booking;
    assert.equal(bookingPushes('b1', partly, cancelled)[0]!.body, 'Jane Smith · 4 guests · No refund');
    const refunded = { ...cancelled, amountRefundedCents: 33600, cancelRefundCents: 29600 } as Booking;
    assert.equal(bookingPushes('b1', partly, refunded)[0]!.body, 'Jane Smith · 4 guests · $296 refunded');
  });

  test('paid for after Travis closed the trip: the push says so, as the crew’s does', () => {
    const [push] = bookingPushes('b1', base, paid, { closedTrip: true });
    assert.equal(push!.title, 'New booking: Sat Nov 14, 8:00 AM shared');
    assert.equal(push!.body, 'On a trip you closed: Jane Smith · 4 guests · $336');
  });

  test('taking the refund after Travis closed the trip is pushed; the deadline’s own refund isn’t', () => {
    const closure = { blackoutId: 'bo1', reason: 'Closed for weather', decideBy: '2026-11-17' };
    const offered = { ...paid, closure } as Booking;
    const took = { ...offered, status: 'cancelled', cancelledBy: 'customer', amountRefundedCents: 33600, cancelRefundCents: 33600 } as Booking;
    const pushes = bookingPushes('b1', offered, took);
    assert.equal(pushes.length, 1, 'not a plain “Cancelled” too');
    assert.equal(pushes[0]!.title, 'Took the refund: Sat Nov 14, 8:00 AM shared');
    assert.equal(pushes[0]!.body, 'Jane Smith · 4 guests · $336 refunded');
    assert.deepEqual(bookingPushes('b1', offered, { ...took, cancelledBy: 'admin' } as Booking), []);

    // An old-site deposit: Travis refunds that money himself.
    const deposit = { ...offered, status: 'pending-payment', guestCount: 0 } as Booking;
    const tookDeposit = { ...deposit, status: 'cancelled', cancelledBy: 'customer', cancelRefundCents: 0, manualRefundCents: 10000 } as Booking;
    assert.equal(bookingPushes('legacy-7', deposit, tookDeposit)[0]!.body, 'Jane Smith · party size unknown · $100 to refund by hand');
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

describe('reviewListPush', () => {
  test('tonight’s requests', () => {
    const push = reviewListPush('2026-06-17', { going: 3, tomorrow: 1 })!;
    assert.equal(push.title, '3 review requests go out at 7:00');
    assert.equal(push.url, '/admin/review-requests');
    assert.equal(push.tag, 'review-list-2026-06-17');
  });

  test('a day whose only trip is back after 7:00 (a sunset cruise): tomorrow morning’s, as the email says', () => {
    assert.equal(reviewListPush('2026-06-17', { going: 0, tomorrow: 1 })!.title, '1 review request goes out tomorrow morning');
  });

  test('nothing when no request is due', () => {
    assert.equal(reviewListPush('2026-06-17', { going: 0, tomorrow: 0 }), null);
    assert.equal(reviewListPush('2026-06-17', {}), null);
  });
});

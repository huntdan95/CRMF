/**
 * What the booking and confirmation pages make of a trip Travis closed
 * without offering a new date (src/components/booking/closed-trip.ts), from
 * what fetchBooking returns. Run with `npm test`.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { closedTrip } from '../src/components/booking/closed-trip';
import type { FetchedBooking } from '../src/lib/functions-client';

// Friday 8 AM at the marina (EDT), the day before the trip.
const FRIDAY = new Date('2026-10-16T12:00:00Z');

const booked: FetchedBooking = {
  id: 'b1',
  tourId: 'morning-shared',
  tourName: 'Morning Shared',
  date: '2026-10-17',
  timeSlot: 'morning',
  type: 'shared',
  guestCount: 2,
  customerName: 'Pat Example',
  customerEmail: 'pat@example.com',
  customerPhone: '555',
  emergencyContactName: 'Sam',
  emergencyContactPhone: '556',
  guests: [],
  status: 'confirmed',
  paymentStatus: 'paid',
  amountPaidCents: 16800,
  amountRefundedCents: 0,
  accessToken: 'token',
  createdAt: null,
  updatedAt: null,
  cancelledAt: null,
  cancellationReason: null,
  closure: null,
  refundGraceUntil: null,
  departureClosed: true,
  closurePending: null,
};

const CALLING_OFF = 'Capt. Travis just called this trip off. You’ll get an email in the next few minutes about your full refund.';

describe('closedTrip', () => {
  test('left booked: closed, nothing pending, no cancel', () => {
    assert.deepEqual(closedTrip(booked, FRIDAY), { closedBooked: true, callingOff: null, canCancelInGrace: false });
  });

  test('put back by a reopen, then closed again: still closed, and the grace keeps the cancel', () => {
    // fetchBooking's answer in functions/test/fetch-booking.test.ts. The
    // grace used to read as "the trip is on": Where to meet, then "Past tour".
    const regraced = { ...booked, refundGraceUntil: '2026-10-20' };
    assert.deepEqual(closedTrip(regraced, FRIDAY), { closedBooked: true, callingOff: null, canCancelInGrace: true });
    // After its deadline, still closed, and no cancel.
    assert.deepEqual(closedTrip(regraced, new Date('2026-10-21T14:00:00Z')), { closedBooked: true, callingOff: null, canCancelInGrace: false });
    // An old-site reservation can't be cancelled online, grace or not.
    const oldSite = { ...regraced, id: 'legacy-12', status: 'pending-payment' as const, paymentStatus: 'pending' as const };
    assert.deepEqual(closedTrip(oldSite, FRIDAY), { closedBooked: true, callingOff: null, canCancelInGrace: false });
  });

  test('being called off: what cancelBooking would say, and no cancel even in a grace', () => {
    const closing = { ...booked, refundGraceUntil: '2026-10-20', closurePending: { choice: 'cancel' as const, message: CALLING_OFF } };
    assert.deepEqual(closedTrip(closing, FRIDAY), { closedBooked: true, callingOff: CALLING_OFF, canCancelInGrace: false });
  });

  test('not a trip that’s on, one they’re choosing a new date for, a cancellation, or a checkout nobody paid for', () => {
    const open = { closedBooked: false, callingOff: null, canCancelInGrace: false };
    assert.deepEqual(closedTrip({ ...booked, departureClosed: false, refundGraceUntil: '2026-10-20' }, FRIDAY), open);
    // An older functions deploy doesn't say.
    assert.deepEqual(closedTrip({ ...booked, departureClosed: undefined }, FRIDAY), open);
    assert.deepEqual(closedTrip({ ...booked, closure: { reason: 'Closed for weather', decideBy: '2026-10-20' } }, FRIDAY), open);
    assert.deepEqual(closedTrip({ ...booked, status: 'cancelled', closurePending: { choice: 'cancel', message: CALLING_OFF } }, FRIDAY), open);
    assert.deepEqual(closedTrip({ ...booked, status: 'pending-payment', paymentStatus: 'pending' }, FRIDAY), open);
  });
});

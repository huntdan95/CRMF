/**
 * The date, clock and seat rules createCheckoutSession enforces.
 * Run with `npm test` in functions/.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  AvailabilityError,
  assertBookingWindow,
  assertSeatsAvailable,
  type AvailabilityReason,
} from '../src/lib/availability';
import {
  departureClosed,
  isRealDate,
  marinaNow,
  type MarinaClock,
} from '../src/lib/datetime';
import { requestSchema } from '../src/createCheckoutSession';
import type { Blackout, Booking, Tour } from '../src/lib/types';

const at = (date: string, hhmm: string): MarinaClock => {
  const [h, m] = hhmm.split(':').map(Number);
  return { date, minutes: h * 60 + m };
};

const morning = { startTime: '08:00', timeSlot: 'morning', type: 'shared', maxGuests: 6 } as Tour;
const morningPrivate = { ...morning, type: 'private' } as Tour;
const wholeDay = { startTime: '07:00', timeSlot: 'whole-day', type: 'private', maxGuests: 6 } as Tour;
const lateAfternoon = { startTime: '15:30', timeSlot: 'late-afternoon', type: 'shared', maxGuests: 6 } as Tour;

function refusedFor(reason: AvailabilityReason) {
  return (err: unknown) => err instanceof AvailabilityError && err.reason === reason;
}

const booking = (b: Partial<Booking>) =>
  ({ status: 'confirmed', type: 'shared', guestCount: 1, ...b }) as Booking;
const blackout = (affectedSlots: Blackout['affectedSlots']) =>
  ({ date: '2026-12-01', affectedSlots }) as Blackout;

describe('isRealDate', () => {
  test('accepts real dates, including leap days', () => {
    assert.ok(isRealDate('2026-11-30'));
    assert.ok(isRealDate('2028-02-29'));
    assert.ok(isRealDate('2026-12-31'));
  });
  test('refuses dates that roll over', () => {
    assert.equal(isRealDate('2026-11-31'), false);
    assert.equal(isRealDate('2026-02-29'), false);
    assert.equal(isRealDate('2026-13-01'), false);
    assert.equal(isRealDate('2026-00-10'), false);
    assert.equal(isRealDate('2026-04-00'), false);
  });
  test('refuses other shapes', () => {
    assert.equal(isRealDate('2026-1-01'), false);
    assert.equal(isRealDate('20261201'), false);
    assert.equal(isRealDate(''), false);
  });
});

describe('marinaNow', () => {
  test('uses Eastern Daylight Time in summer', () => {
    assert.deepEqual(marinaNow(new Date('2026-07-04T11:59:00Z')), at('2026-07-04', '07:59'));
  });
  test('uses Eastern Standard Time in winter', () => {
    assert.deepEqual(marinaNow(new Date('2026-12-01T13:00:00Z')), at('2026-12-01', '08:00'));
  });
  test('is still yesterday at the marina after midnight UTC', () => {
    assert.deepEqual(marinaNow(new Date('2026-07-05T02:30:00Z')), at('2026-07-04', '22:30'));
  });
  test('reads midnight as minute 0', () => {
    assert.deepEqual(marinaNow(new Date('2026-07-04T04:00:00Z')), at('2026-07-04', '00:00'));
  });
});

describe('departureClosed', () => {
  test('closes 60 minutes before the boat leaves', () => {
    assert.equal(departureClosed('2026-12-01', '08:00', at('2026-12-01', '06:59')), false);
    assert.equal(departureClosed('2026-12-01', '08:00', at('2026-12-01', '07:00')), true);
    assert.equal(departureClosed('2026-12-01', '08:00', at('2026-12-01', '09:00')), true);
  });
  test('earlier days are closed, later days open', () => {
    assert.equal(departureClosed('2026-11-30', '15:30', at('2026-12-01', '00:00')), true);
    assert.equal(departureClosed('2026-12-02', '07:00', at('2026-12-01', '23:59')), false);
  });
});

describe('assertBookingWindow', () => {
  const now = at('2026-10-13', '07:00');

  test('allows a later departure today', () => {
    assert.doesNotThrow(() => assertBookingWindow({ tour: lateAfternoon, date: '2026-10-13', now }));
  });
  test('refuses a departure inside the cutoff with reason "departed"', () => {
    assert.throws(() => assertBookingWindow({ tour: morning, date: '2026-10-13', now }), refusedFor('departed'));
  });
  test('refuses the whole-day charter after 6:00 on the day', () => {
    assert.throws(
      () => assertBookingWindow({ tour: wholeDay, date: '2026-10-13', now: at('2026-10-13', '06:00') }),
      refusedFor('departed'),
    );
    assert.doesNotThrow(() =>
      assertBookingWindow({ tour: wholeDay, date: '2026-10-13', now: at('2026-10-13', '05:59') }),
    );
  });
  test('refuses a date that has passed', () => {
    assert.throws(() => assertBookingWindow({ tour: lateAfternoon, date: '2026-10-12', now }), refusedFor('departed'));
  });
  test('refuses a date that is not on the calendar', () => {
    assert.throws(() => assertBookingWindow({ tour: morning, date: '2026-11-31', now }), refusedFor('invalid-date'));
  });
  test('allows up to 365 days out, and no further', () => {
    assert.doesNotThrow(() => assertBookingWindow({ tour: morning, date: '2027-10-13', now }));
    assert.throws(() => assertBookingWindow({ tour: morning, date: '2027-10-14', now }), refusedFor('too-far-ahead'));
  });
  test('counts the 365 days across a leap day', () => {
    const march = at('2027-03-01', '12:00');
    assert.doesNotThrow(() => assertBookingWindow({ tour: morning, date: '2028-02-29', now: march }));
    assert.throws(() => assertBookingWindow({ tour: morning, date: '2028-03-01', now: march }), refusedFor('too-far-ahead'));
  });
});

describe('assertSeatsAvailable', () => {
  const date = '2026-12-01';

  test('refuses the whole-day charter when a slot inside its hours is blacked out', () => {
    for (const slot of ['morning', 'mid-morning', 'early-afternoon'] as const) {
      assert.throws(
        () => assertSeatsAvailable({ tour: wholeDay, date, guestCount: 2, bookings: [], blackouts: [blackout([slot])] }),
        refusedFor('blackout-slot'),
        slot,
      );
    }
  });
  test('allows the whole-day charter when only late afternoon is blacked out', () => {
    assert.doesNotThrow(() =>
      assertSeatsAvailable({ tour: wholeDay, date, guestCount: 2, bookings: [], blackouts: [blackout(['late-afternoon'])] }),
    );
  });
  test('a whole-day blackout leaves the two-hour departures alone', () => {
    assert.doesNotThrow(() =>
      assertSeatsAvailable({ tour: morning, date, guestCount: 2, bookings: [], blackouts: [blackout(['whole-day'])] }),
    );
  });
  test('still refuses day and slot blackouts', () => {
    assert.throws(
      () => assertSeatsAvailable({ tour: morning, date, guestCount: 1, bookings: [], blackouts: [blackout(['all'])] }),
      refusedFor('blackout-day'),
    );
    assert.throws(
      () => assertSeatsAvailable({ tour: morning, date, guestCount: 1, bookings: [], blackouts: [blackout(['morning'])] }),
      refusedFor('blackout-slot'),
    );
  });
  test('counts shared seats, ignoring cancelled bookings', () => {
    const bookings = [
      booking({ timeSlot: 'morning', guestCount: 4 }),
      booking({ timeSlot: 'morning', guestCount: 2, status: 'cancelled' }),
    ];
    assert.doesNotThrow(() => assertSeatsAvailable({ tour: morning, date, guestCount: 2, bookings, blackouts: [] }));
    assert.throws(
      () => assertSeatsAvailable({ tour: morning, date, guestCount: 3, bookings, blackouts: [] }),
      refusedFor('slot-shared-full'),
    );
  });
  test('an old-site booking with no party size fills the shared boat', () => {
    const unknownSize = booking({ timeSlot: 'morning', guestCount: 0 });
    assert.throws(
      () => assertSeatsAvailable({ tour: morning, date, guestCount: 1, bookings: [unknownSize], blackouts: [] }),
      refusedFor('slot-shared-full'),
    );
  });
  test('an unpaid hold blocks a private boat until it is released', () => {
    const hold = booking({ timeSlot: 'morning', type: 'private', status: 'pending-payment', guestCount: 4 });
    assert.throws(
      () => assertSeatsAvailable({ tour: morningPrivate, date, guestCount: 4, bookings: [hold], blackouts: [] }),
      refusedFor('slot-private-booked'),
    );
    const released = { ...hold, status: 'cancelled' } as Booking;
    assert.doesNotThrow(() =>
      assertSeatsAvailable({ tour: morningPrivate, date, guestCount: 4, bookings: [released], blackouts: [] }),
    );
  });
});

describe('createCheckoutSession request', () => {
  const valid = {
    tourSlug: 'morning-shared',
    date: '2026-12-01',
    guestCount: 1,
    customer: { name: 'Pat Doe', email: 'pat@example.com', phone: '352 555 0100' },
    emergencyContact: { name: 'Sam Doe', phone: '352 555 0101' },
    guests: [{ name: 'Pat Doe', age: null }],
    acknowledgements: { manateeManners: true, liabilityWaiver: true },
  };

  test('accepts a real date', () => {
    assert.ok(requestSchema.safeParse(valid).success);
  });
  test('takes the terms agreement and the terms version it was given', () => {
    const parsed = requestSchema.safeParse({
      ...valid,
      acknowledgements: { ...valid.acknowledgements, termsOfService: true },
      termsVersion: '2026-10-14',
    });
    assert.ok(parsed.success);
    assert.equal(parsed.data.termsVersion, '2026-10-14');
  });
  test('refuses a terms version that is not a date', () => {
    const parsed = requestSchema.safeParse({ ...valid, termsVersion: 'latest' });
    assert.equal(parsed.success, false);
  });
  test('refuses a date that is not on the calendar', () => {
    const parsed = requestSchema.safeParse({ ...valid, date: '2026-11-31' });
    assert.equal(parsed.success, false);
  });
  test('takes an optional previous checkout to release', () => {
    const parsed = requestSchema.safeParse({
      ...valid,
      previousBooking: { bookingId: 'abc123', accessToken: '6f1c7a52-0000-4000-8000-000000000000' },
    });
    assert.ok(parsed.success);
    assert.equal(parsed.data.previousBooking?.bookingId, 'abc123');
  });
  test('refuses a malformed previous checkout', () => {
    const parsed = requestSchema.safeParse({ ...valid, previousBooking: { bookingId: 'abc123' } });
    assert.equal(parsed.success, false);
  });
});

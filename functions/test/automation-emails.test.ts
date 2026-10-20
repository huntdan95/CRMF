/**
 * The automated guest and crew emails: trip prep, day-of directions, trip
 * photos and the crew alerts. Run with `npm test` in functions/.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { buildDirectionsEmail, buildTripPhotosEmail, buildTripPrepEmail } from '../src/lib/guest-templates';
import { buildCrewBookingAlert, buildCrewSchedule } from '../src/lib/crew-templates';
import { departureLabel, departureMinutes } from '../src/lib/trip-format';
import { slotStartMinutes } from '../src/lib/schedule';
import { DEFAULT_WETSUIT_SIZES } from '../src/lib/site-settings';
import type { Booking } from '../src/lib/types';

const BASE_URL = 'https://example.com';

const booking = {
  id: 'b1',
  tourId: 'morning-shared',
  tourName: '2hr Morning Tour — Shared',
  date: '2026-11-14',
  timeSlot: 'morning',
  type: 'shared',
  guestCount: 2,
  guests: [
    { name: 'Pat Example', age: 40, wetsuitSize: 'L' },
    { name: 'Sam Example', age: 8, wetsuitSize: 'Kids 8' },
  ],
  customerName: 'Pat Example',
  customerEmail: 'pat@example.com',
  customerPhone: '352-555-0100',
  accessToken: 'tok123',
  status: 'confirmed',
  paymentStatus: 'paid',
  amountPaidCents: 16800,
  amountRefundedCents: 0,
} as unknown as Booking;

const cruise = {
  ...booking,
  id: 'c1',
  tourId: 'sunset-private',
  tourName: 'Private Sunset Cruise',
  date: '2026-10-17',
  timeSlot: 'sunset',
  type: 'private',
} as unknown as Booking;

/** "6:15 PM" for minutes after midnight. */
function clock(mins: number): string {
  const h = Math.floor(mins / 60);
  return `${h % 12 || 12}:${String(mins % 60).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

describe('trip prep email', () => {
  test('a manatee tour: arrival window, parking, what to wear, the video', () => {
    const email = buildTripPrepEmail({ booking, baseUrl: BASE_URL });
    assert.equal(email.subject, 'Getting ready for your manatee tour on Saturday, November 14');
    assert.match(email.text, /Arrive 20 to 30 minutes before departure: 7:30–7:40 AM\./);
    assert.match(email.text, /Pete's Pier parking lot/);
    assert.match(email.text, /swimsuit, under clothes suited to the weather/);
    assert.match(email.text, /manatee manners video/);
    assert.match(email.text, /Your booking: https:\/\/example\.com\/my-booking\/b1\?t=tok123/);
    assert.match(email.html, /Watch the video/);
  });

  test('the sunset cruise: its own departure time, BYOB, no swim gear or video', () => {
    const email = buildTripPrepEmail({ booking: cruise, baseUrl: BASE_URL });
    const departs = clock(slotStartMinutes('sunset', cruise.date));
    assert.match(email.subject, /sunset cruise/);
    assert.match(email.text, new RegExp(`departing at ${departs}`));
    assert.match(email.text, /BYOB/);
    assert.doesNotMatch(email.text, /manners video|WHAT WE PROVIDE|swimsuit/);
  });

  test('an old-site booking gets no manage link (it has no page)', () => {
    const email = buildTripPrepEmail({ booking: { ...booking, id: 'legacy-42' } as Booking, baseUrl: BASE_URL });
    assert.doesNotMatch(email.text, /Your booking:/);
  });
});

describe('day-of directions email', () => {
  test('names the departure and links both map apps', () => {
    const email = buildDirectionsEmail({ booking, baseUrl: BASE_URL });
    assert.equal(email.subject, 'Today: directions to your 8:00 AM manatee tour');
    assert.match(email.text, /Google Maps: https:\/\/www\.google\.com\/maps\/dir\/\?api=1&destination=Pete%27s/);
    assert.match(email.text, /Apple Maps: https:\/\/maps\.apple\.com\//);
    assert.match(email.text, /Arrive 20 to 30 minutes before departure: 7:30–7:40 AM\./);
  });
});

describe('trip photos email', () => {
  test('links the gallery and asks for an Instagram tag, not a review', () => {
    const email = buildTripPhotosEmail({ booking, galleryUrl: `${BASE_URL}/my-booking/b1/photos?t=tok123`, count: 12 });
    assert.match(email.text, /12 photos and videos so far/);
    assert.match(email.text, /my-booking\/b1\/photos\?t=tok123/);
    assert.match(email.text, /@capt\.travisurbin/);
    assert.doesNotMatch(email.text, /review/i);
  });
});

describe('crew emails', () => {
  test('a new-booking alert leads with [CRMF], the departure and the wetsuit tally', () => {
    const email = buildCrewBookingAlert({ booking, baseUrl: BASE_URL, sizes: DEFAULT_WETSUIT_SIZES, boat: [2] });
    assert.equal(email.subject, '[CRMF] New booking: Sat Nov 14, 8:00 AM shared, 2 guests');
    assert.match(email.text, /352-555-0100/);
    assert.match(email.text, /https:\/\/example\.com\/admin\/bookings\/b1/);
  });

  test('nobody is asked for a wetsuit size on the sunset cruise, so the alert has no wetsuit line', () => {
    const email = buildCrewBookingAlert({ booking: cruise, baseUrl: BASE_URL, sizes: DEFAULT_WETSUIT_SIZES, boat: [2] });
    assert.doesNotMatch(email.text, /Wetsuits/);
    assert.match(buildCrewBookingAlert({ booking, baseUrl: BASE_URL, sizes: DEFAULT_WETSUIT_SIZES, boat: [2] }).text, /Wetsuits: 1 × L/);
  });

  test('the sunset cruise reads as a cruise at its own time', () => {
    const departs = clock(slotStartMinutes('sunset', cruise.date));
    assert.equal(departureLabel(cruise), `${departs} private sunset cruise`);
    assert.equal(departureMinutes('sunset', cruise.date), slotStartMinutes('sunset', cruise.date));
  });

  test('the nightly schedule counts trips and guests, with upload links', () => {
    const email = buildCrewSchedule({
      date: '2026-11-14',
      trips: [{ timeSlot: 'morning', bookings: [booking], uploadUrl: `${BASE_URL}/upload/abc` }],
      baseUrl: BASE_URL,
      sizes: DEFAULT_WETSUIT_SIZES,
    });
    assert.equal(email.subject, '[CRMF] Tomorrow: 1 trip, 2 guests');
    assert.match(email.text, /Photo upload: https:\/\/example\.com\/upload\/abc/);
    assert.match(email.text, /Manifest: https:\/\/example\.com\/admin\/bookings\/b1\/manifest/);
  });
});

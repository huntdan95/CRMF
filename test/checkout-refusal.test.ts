/**
 * What the booking page tells a customer when checkout turns their
 * departure down (checkoutRefusalMessage in src/lib/functions-client.ts).
 * The server's message is written for Travis, so none of it is shown. Run
 * with `npm test`.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { checkoutRefusalMessage } from '../src/lib/functions-client';

const departure = 'the 10:30 AM shared tour on Saturday, October 24';
const HOLD = 'If you started a checkout in another tab or window, your earlier hold can take up to 30 minutes to clear.';

describe('checkoutRefusalMessage', () => {
  test('a closed day or departure says Travis closed it, never why, and nothing about holds', () => {
    for (const reason of ['blackout-day', 'blackout-slot']) {
      for (const holdSent of [true, false]) {
        assert.equal(
          checkoutRefusalMessage(reason, { departure, guests: 2, holdSent }),
          'Capt. Travis has closed the 10:30 AM shared tour on Saturday, October 24.',
        );
      }
    }
  });

  test('seats taken: how many the party needed, in words', () => {
    assert.equal(
      checkoutRefusalMessage('slot-shared-full', { departure, guests: 2, holdSent: true }),
      'The 10:30 AM shared tour on Saturday, October 24 now has fewer than 2 seats left.',
    );
    assert.equal(
      checkoutRefusalMessage('slot-shared-full', { departure, guests: 1, holdSent: true }),
      'The 10:30 AM shared tour on Saturday, October 24 is now full.',
    );
  });

  test('the boat taken: by whom, without slot names or dates', () => {
    const boat = 'the 3:30 PM private boat on Saturday, October 24';
    const said = (reason: string) => checkoutRefusalMessage(reason, { departure: boat, guests: 2, holdSent: true });
    assert.equal(
      said('slot-private-booked'),
      'The 3:30 PM private boat on Saturday, October 24 is no longer available: the boat has been booked privately at that time.',
    );
    assert.equal(
      said('slot-private-conflict'),
      'The 3:30 PM private boat on Saturday, October 24 is no longer available: guests have booked seats on the shared tour at that time.',
    );
    assert.equal(
      said('slot-conflict'),
      'The 3:30 PM private boat on Saturday, October 24 is no longer available: the boat has been booked for another trip at that time.',
    );
    assert.equal(
      said('whole-day-booked'),
      'The 3:30 PM private boat on Saturday, October 24 is no longer available: the boat has been booked that day.',
    );
  });

  test('the earlier-hold sentence only for taken seats, and only when no hold of this tab’s went to be released', () => {
    for (const reason of ['slot-shared-full', 'slot-private-booked', 'slot-private-conflict', 'slot-conflict', 'whole-day-booked']) {
      assert.ok(checkoutRefusalMessage(reason, { departure, guests: 2, holdSent: false }).endsWith(` ${HOLD}`), reason);
      assert.ok(!checkoutRefusalMessage(reason, { departure, guests: 2, holdSent: true }).includes('hold'), reason);
    }
    for (const reason of ['blackout-day', 'too-far-ahead', 'out-of-season', undefined]) {
      assert.ok(!checkoutRefusalMessage(reason, { departure, guests: 2, holdSent: false }).includes('hold'), String(reason));
    }
  });

  test('anything else reads as a plain refusal', () => {
    assert.equal(
      checkoutRefusalMessage('too-far-ahead', { departure, guests: 2, holdSent: true }),
      'The 10:30 AM shared tour on Saturday, October 24 is further out than we take bookings online.',
    );
    for (const reason of ['out-of-season', 'invalid-guest-count', undefined]) {
      assert.equal(
        checkoutRefusalMessage(reason, { departure, guests: 2, holdSent: false }),
        'The 10:30 AM shared tour on Saturday, October 24 can’t be booked online.',
      );
    }
  });
});

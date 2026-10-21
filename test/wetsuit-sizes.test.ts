/**
 * The wetsuit choices the booking form and admin edit offer
 * (src/lib/site-settings.ts), against what checkout and adminEditBooking
 * accept and how the crew's tally counts them
 * (functions/src/lib/site-settings.ts). Run with `npm test`.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_WETSUIT_SIZES, NO_WETSUIT, wetsuitChoices } from '../src/lib/site-settings';
import {
  NO_WETSUIT as FUNCTIONS_NO_WETSUIT,
  wetsuitChoices as functionsChoices,
  wetsuitTally,
} from '../functions/src/lib/site-settings';

describe('wetsuit choices', () => {
  test('the form offers exactly what the functions accept, “not swimming” included', () => {
    const custom = { adult: ['M', 'XL'], kids: ['6'] };
    for (const sizes of [DEFAULT_WETSUIT_SIZES, custom]) {
      assert.deepEqual(wetsuitChoices(sizes), functionsChoices(sizes));
    }
    assert.equal(NO_WETSUIT, FUNCTIONS_NO_WETSUIT);
    assert.ok(wetsuitChoices(custom).includes(NO_WETSUIT));
  });

  test('the crew tally counts guests who aren’t swimming apart, not as a suit', () => {
    const guests = [
      { wetsuitSize: 'XL' },
      { wetsuitSize: NO_WETSUIT },
      { wetsuitSize: 'Kids 8' },
      { wetsuitSize: 'XL' },
      { wetsuitSize: null },
    ];
    assert.equal(wetsuitTally(guests, DEFAULT_WETSUIT_SIZES), '2 × XL, 1 × Kids 8, 1 not swimming, 1 not given');
  });
});

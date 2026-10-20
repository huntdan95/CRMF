import { test } from 'node:test';
import assert from 'node:assert/strict';
import { salesTaxOn } from '../src/lib/pricing';
import { salesTaxOn as functionsSalesTaxOn } from '../functions/src/lib/pricing';

test('6% Florida sales tax, to the nearest cent', () => {
  assert.equal(salesTaxOn(8400), 504); // one $84 seat
  assert.equal(salesTaxOn(25200), 1512); // three seats: $267.12, what the old site charged
  assert.equal(salesTaxOn(50000), 3000); // private boat
  assert.equal(salesTaxOn(8450), 507); // $5.07, rounded
});

test('the site and checkout work out the same tax', () => {
  for (const cents of [0, 50, 8400, 12345, 89500]) {
    assert.equal(salesTaxOn(cents), functionsSalesTaxOn(cents));
  }
});

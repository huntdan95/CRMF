/**
 * Which price edits adminUpdateTour (and so MCP update_tour) turns down.
 * Run with `npm test` in functions/.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { tourPriceProblem } from '../src/adminTours';

const shared = { type: 'shared' as const, pricePerPerson: 8400, flatPrice: null };
const boat = { type: 'private' as const, pricePerPerson: null, flatPrice: 50000 };

describe('tourPriceProblem', () => {
  test('the price each kind of tour is charged at can change', () => {
    assert.equal(tourPriceProblem(shared, { pricePerPerson: 9000 }), null);
    assert.equal(tourPriceProblem(boat, { flatPrice: 55000 }), null);
  });

  test('the price checkout never reads is turned down', () => {
    assert.match(tourPriceProblem(shared, { flatPrice: 50000 }) ?? '', /shared tour/);
    assert.match(tourPriceProblem(boat, { pricePerPerson: 9000 }) ?? '', /private tour/);
  });

  test('Admin → Tours sending the other field back as it was is fine', () => {
    assert.equal(tourPriceProblem(shared, { pricePerPerson: 9000, flatPrice: null }), null);
    assert.equal(tourPriceProblem({ ...boat, pricePerPerson: 8400 }, { flatPrice: 55000, pricePerPerson: 8400 }), null);
  });

  test('the price a tour is charged at cannot be cleared', () => {
    assert.ok(tourPriceProblem(shared, { pricePerPerson: null }));
    assert.ok(tourPriceProblem(boat, { flatPrice: null }));
  });
});

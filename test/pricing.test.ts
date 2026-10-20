/**
 * Price ranges the site quotes, and the price changes admin asks Travis to
 * confirm (src/lib/pricing.ts). Run with `npm test`.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { bigPriceChange, formatPriceRange, kindPriceRanges, priceChangeWords } from '../src/lib/pricing';
import { tours } from '../src/lib/tours';

describe('kindPriceRanges', () => {
  test('the sunset cruise never sets the two-hour private boats’ “from”', () => {
    // The cruise switched on, as in season: $400 against the $500 boats.
    const live = tours.map((t) => (t.timeSlot === 'sunset' ? { ...t, active: true } : t));
    const cruise = live.find((t) => t.timeSlot === 'sunset')!;
    const boats = live.filter((t) => t.type === 'private' && t.timeSlot !== 'whole-day' && t.timeSlot !== 'sunset');
    assert.ok(cruise.flatPrice! < Math.min(...boats.map((t) => t.flatPrice!)), 'the cruise is the cheaper private trip');
    const ranges = kindPriceRanges(live, '2026-10-20', []);
    assert.equal(ranges.private!.min, Math.min(...boats.map((t) => t.flatPrice!)));
    assert.ok(!formatPriceRange(ranges.private).includes(`$${cruise.flatPrice! / 100}`));
  });
});

describe('bigPriceChange', () => {
  test('more than half again, or less than half, what it was', () => {
    assert.equal(bigPriceChange(8400, 840), true);
    assert.equal(bigPriceChange(8400, 4100), true);
    assert.equal(bigPriceChange(8400, 4200), false);
    assert.equal(bigPriceChange(8400, 12600), false);
    assert.equal(bigPriceChange(8400, 12700), true);
    assert.equal(bigPriceChange(8400, 9900), false);
  });

  test('said in words', () => {
    assert.equal(priceChangeWords(8400, 840), '90% less');
    assert.equal(priceChangeWords(8400, 13000), '55% more');
  });
});

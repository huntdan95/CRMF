/**
 * The Florida sales tax Reports, its spreadsheet and the dashboard show
 * apart from the tour price (src/lib/sales-tax-split.ts). Run with `npm test`.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { salesTaxNote, salesTaxSplit, salesTaxTotals } from '../src/lib/sales-tax-split';
import { formatPrice } from '../src/lib/tours';

// Three $84 seats: $252 + $15.12 tax.
const threeSeats = { amountPaidCents: 26712, amountRefundedCents: 0, subtotalCents: 25200, salesTaxCents: 1512 };
// Paid on the old site, whose 6% is in the amount but not recorded.
const oldSite = { amountPaidCents: 26712, amountRefundedCents: 0 };

describe('salesTaxSplit', () => {
  test('a booking made with tax: price and tax add up to what was paid', () => {
    assert.deepEqual(salesTaxSplit(threeSeats), { subtotalCents: 25200, salesTaxCents: 1512, salesTaxKeptCents: 1512 });
  });

  test('a refund gives back its share of the tax', () => {
    // One seat refunded with its tax ($89.04): two seats' tax is kept.
    assert.equal(salesTaxSplit({ ...threeSeats, amountRefundedCents: 8904 })!.salesTaxKeptCents, 1008);
    // Refunded by amount, so $84 takes $4.75 of tax with it.
    assert.equal(salesTaxSplit({ ...threeSeats, amountRefundedCents: 8400 })!.salesTaxKeptCents, 1037);
    assert.equal(salesTaxSplit({ ...threeSeats, amountRefundedCents: 26712 })!.salesTaxKeptCents, 0);
    // A whole day ($895 + $53.70) moved to a 2-hour boat ($500), the
    // difference refunded with its tax: the tax on $500 is kept.
    const wholeDay = { amountPaidCents: 94870, amountRefundedCents: 41870, subtotalCents: 89500, salesTaxCents: 5370 };
    assert.equal(salesTaxSplit(wholeDay)!.salesTaxKeptCents, 3000);
  });

  test('old-site and pre-tax bookings: tax included, not split, never none', () => {
    assert.equal(salesTaxSplit(oldSite), null);
  });

  test('nothing paid: no tax in it, whatever checkout priced', () => {
    const stillPaying = { ...threeSeats, amountPaidCents: 0 };
    assert.deepEqual(salesTaxSplit(stillPaying), { subtotalCents: 0, salesTaxCents: 0, salesTaxKeptCents: 0 });
    assert.deepEqual(salesTaxSplit({ amountPaidCents: 0 }), { subtotalCents: 0, salesTaxCents: 0, salesTaxKeptCents: 0 });
  });
});

describe('salesTaxTotals', () => {
  test('tax from bookings that record it; the others counted apart', () => {
    const totals = salesTaxTotals([
      threeSeats,
      { ...threeSeats, amountRefundedCents: 8904 },
      { ...oldSite, manualRefundCents: 10000 },
    ]);
    assert.deepEqual(totals, {
      takenCents: 3024,
      keptCents: 2520,
      unsplitTakenCents: 26712,
      unsplitKeptCents: 16712,
    });
  });
});

describe('salesTaxNote', () => {
  test('says how much is tax, and what isn’t split', () => {
    assert.equal(salesTaxNote(15120, 0, formatPrice), 'of which $151.20 Florida sales tax');
    assert.equal(salesTaxNote(0, 200000, formatPrice), 'Florida sales tax included, not split (older bookings)');
    assert.equal(
      salesTaxNote(15120, 200000, formatPrice),
      'of which $151.20 Florida sales tax, and $2000 from older bookings: tax included, not split',
    );
  });
});

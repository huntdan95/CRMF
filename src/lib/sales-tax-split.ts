/**
 * The Florida sales tax inside what customers paid, for Reports, its
 * spreadsheet and the dashboard. The tax is owed to the state, not Travis's
 * money, so it's shown apart from the tour price.
 *
 * Checkout records each booking's price before tax and the tax on it
 * (`subtotalCents`, `salesTaxCents`). Older bookings don't: old-site
 * imports, whose amounts already include the old site's 6%, and any made
 * here before the tax was added. Their tax is in the amounts but can't be
 * split out, so it's reported that way, never as no tax.
 *
 * Pure and client-safe.
 */

/** The money a booking records; the app's and the dashboard's booking types both fit. */
export interface BookingMoney {
  amountPaidCents: number;
  amountRefundedCents?: number;
  manualRefundCents?: number;
  subtotalCents?: number;
  salesTaxCents?: number;
}

export interface SalesTaxSplit {
  /** What was paid, before tax. */
  subtotalCents: number;
  /** The tax in what was paid. */
  salesTaxCents: number;
  /** The tax in what's left after refunds. */
  salesTaxKeptCents: number;
}

/** What was paid, less refunds (by hand too): Reports' Kept. */
export function keptCents(b: BookingMoney): number {
  return b.amountPaidCents - (b.amountRefundedCents ?? 0) - (b.manualRefundCents ?? 0);
}

/**
 * The booking's payment split into price and tax, or null when it doesn't
 * record its tax. Refunds are by amount, not by seat, so each gives back its
 * share of the tax: the tax kept is the same part of the tax as what's kept
 * is of what was paid.
 */
export function salesTaxSplit(b: BookingMoney): SalesTaxSplit | null {
  const paid = b.amountPaidCents;
  // Nothing paid (an unfinished checkout, an old reservation with no
  // deposit): no tax in it, whatever checkout priced.
  if (!(paid > 0)) return { subtotalCents: 0, salesTaxCents: 0, salesTaxKeptCents: 0 };
  if (typeof b.subtotalCents !== 'number' || typeof b.salesTaxCents !== 'number') return null;
  const kept = Math.min(paid, Math.max(0, keptCents(b)));
  return {
    // The recorded price, worked out so price and tax always add up to Paid.
    subtotalCents: paid - b.salesTaxCents,
    salesTaxCents: b.salesTaxCents,
    salesTaxKeptCents: Math.round((b.salesTaxCents * kept) / paid),
  };
}

export interface SalesTaxTotals {
  /** Tax in what was taken, and in what was kept, on bookings that record it. */
  takenCents: number;
  keptCents: number;
  /** Taken and kept on bookings whose tax is included but not split out. */
  unsplitTakenCents: number;
  unsplitKeptCents: number;
}

export function salesTaxTotals(bookings: readonly BookingMoney[]): SalesTaxTotals {
  const totals: SalesTaxTotals = { takenCents: 0, keptCents: 0, unsplitTakenCents: 0, unsplitKeptCents: 0 };
  for (const b of bookings) {
    const split = salesTaxSplit(b);
    if (split) {
      totals.takenCents += split.salesTaxCents;
      totals.keptCents += split.salesTaxKeptCents;
    } else {
      totals.unsplitTakenCents += b.amountPaidCents;
      totals.unsplitKeptCents += keptCents(b);
    }
  }
  return totals;
}

/**
 * The line under a money total: "of which $151.20 Florida sales tax", and
 * what of it came from bookings whose tax isn't split out.
 */
export function salesTaxNote(taxCents: number, unsplitCents: number, money: (cents: number) => string): string {
  if (unsplitCents === 0) return `of which ${money(taxCents)} Florida sales tax`;
  if (taxCents === 0) return 'Florida sales tax included, not split (older bookings)';
  return `of which ${money(taxCents)} Florida sales tax, and ${money(unsplitCents)} from older bookings: tax included, not split`;
}

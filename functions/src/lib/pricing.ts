/**
 * MUST stay in sync with `src/lib/pricing.ts` in the parent Next.js app,
 * which shows guests the same prices this charges. Duplicated for the same
 * reason as ./types.ts.
 */
import type { RateSeason, Tour } from './types';

export type SeasonRates = Pick<RateSeason, 'id' | 'name' | 'startDate' | 'endDate' | 'prices'>;

type Priced = Pick<Tour, 'slug' | 'type' | 'pricePerPerson' | 'flatPrice'>;

export function standardUnitPrice(tour: Priced): number {
  return (tour.type === 'shared' ? tour.pricePerPerson : tour.flatPrice) ?? 0;
}

function spanDays(s: SeasonRates): number {
  return (Date.parse(s.endDate) - Date.parse(s.startDate)) / 86_400_000;
}

/** Shorter range first; ties go to the later start, then the id. */
function moreSpecific(a: SeasonRates, b: SeasonRates): number {
  return spanDays(a) - spanDays(b) || b.startDate.localeCompare(a.startDate) || a.id.localeCompare(b.id);
}

/** Of the seasons that cover `date` and price this tour, the shortest. */
export function seasonFor(tour: Priced, date: string, seasons: readonly SeasonRates[]): SeasonRates | null {
  let best: SeasonRates | null = null;
  for (const s of seasons) {
    if (date < s.startDate || date > s.endDate || s.prices[tour.slug] == null) continue;
    if (!best || moreSpecific(s, best) < 0) best = s;
  }
  return best;
}

export function unitPriceOn(tour: Priced, date: string, seasons: readonly SeasonRates[]): number {
  const season = seasonFor(tour, date, seasons);
  return season ? season.prices[tour.slug]! : standardUnitPrice(tour);
}

/** Seats × price for shared, the boat price for private. */
export function totalOn(tour: Priced, guests: number, date: string, seasons: readonly SeasonRates[]): number {
  const unit = unitPriceOn(tour, date, seasons);
  return tour.type === 'shared' ? unit * guests : unit;
}

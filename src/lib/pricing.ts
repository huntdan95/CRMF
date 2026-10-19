/**
 * What a tour costs on a given date. Standard prices live on the tour; a
 * rate season (Admin → Tours → Seasonal rates) can override them for a
 * date range.
 *
 * Pure and client-safe. Checkout resolves prices with a copy of these
 * rules (functions/src/lib/pricing.ts), so the price on screen is the
 * price Stripe charges. Change both together.
 */
import type { RateSeason, Tour } from './firebase/types';
import { formatPrice } from './tours';

/** The parts of a season that set prices; safe to hand to the browser. */
export type SeasonRates = Pick<RateSeason, 'id' | 'name' | 'startDate' | 'endDate' | 'prices'>;

type Priced = Pick<Tour, 'slug' | 'type' | 'pricePerPerson' | 'flatPrice'>;

/** Standard price in the tour's unit: per person (shared) or the boat (private). */
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

/**
 * The season whose price applies to this tour on `date`: of the ranges
 * that cover the date and price the tour, the shortest, so a holiday beats
 * the season around it. The answer never depends on list order.
 */
export function seasonFor(tour: Priced, date: string, seasons: readonly SeasonRates[]): SeasonRates | null {
  let best: SeasonRates | null = null;
  for (const s of seasons) {
    if (date < s.startDate || date > s.endDate || s.prices[tour.slug] == null) continue;
    if (!best || moreSpecific(s, best) < 0) best = s;
  }
  return best;
}

/** Price in the tour's unit on `date`. */
export function unitPriceOn(tour: Priced, date: string, seasons: readonly SeasonRates[]): number {
  const season = seasonFor(tour, date, seasons);
  return season ? season.prices[tour.slug]! : standardUnitPrice(tour);
}

/** What a booking costs: seats × price for shared, the boat price for private. */
export function totalOn(tour: Priced, guests: number, date: string, seasons: readonly SeasonRates[]): number {
  const unit = unitPriceOn(tour, date, seasons);
  return tour.type === 'shared' ? unit * guests : unit;
}

export interface PriceRange {
  min: number;
  max: number;
}

/**
 * Every unit price these tours can be booked at from `today` on: their
 * standard prices plus any season that hasn't ended. Null for no tours.
 */
export function upcomingPriceRange(
  tours: readonly Priced[],
  today: string,
  seasons: readonly SeasonRates[],
): PriceRange | null {
  const prices: number[] = [];
  for (const tour of tours) {
    prices.push(standardUnitPrice(tour));
    for (const s of seasons) {
      const p = s.prices[tour.slug];
      if (p != null && s.endDate >= today) prices.push(p);
    }
  }
  if (prices.length === 0) return null;
  return { min: Math.min(...prices), max: Math.max(...prices) };
}

/** Lowest and highest unit price of these tours on one date. Null for no tours. */
export function priceRangeOn(
  tours: readonly Priced[],
  date: string,
  seasons: readonly SeasonRates[],
): PriceRange | null {
  if (tours.length === 0) return null;
  const prices = tours.map((t) => unitPriceOn(t, date, seasons));
  return { min: Math.min(...prices), max: Math.max(...prices) };
}

export interface KindPriceRanges {
  shared: PriceRange | null;
  /** Two-hour private boats. */
  private: PriceRange | null;
  wholeDay: PriceRange | null;
  all: PriceRange | null;
}

/** Upcoming price ranges for each kind of tour people choose between, running tours only. */
export function kindPriceRanges(
  tours: ReadonlyArray<Priced & Pick<Tour, 'timeSlot' | 'active'>>,
  today: string,
  seasons: readonly SeasonRates[],
): KindPriceRanges {
  const running = tours.filter((t) => t.active);
  const of = (keep: (t: (typeof running)[number]) => boolean) =>
    upcomingPriceRange(running.filter(keep), today, seasons);
  return {
    shared: of((t) => t.type === 'shared'),
    private: of((t) => t.type === 'private' && t.timeSlot !== 'whole-day' && t.timeSlot !== 'sunset'),
    wholeDay: of((t) => t.timeSlot === 'whole-day'),
    all: of(() => true),
  };
}

/** `$84`, or `from $84` when the price depends on the date or departure. */
export function formatPriceRange(range: PriceRange | null, { capitalize = false } = {}): string {
  if (!range) return '';
  if (range.min === range.max) return formatPrice(range.min);
  return `${capitalize ? 'From' : 'from'} ${formatPrice(range.min)}`;
}

/** Seasons that price this tour and haven't ended, soonest first. */
export function upcomingSeasonsFor(
  tour: Priced,
  today: string,
  seasons: readonly SeasonRates[],
): Array<SeasonRates & { price: number }> {
  return seasons
    .filter((s) => s.endDate >= today && s.prices[tour.slug] != null)
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || moreSpecific(a, b))
    .map((s) => ({ ...s, price: s.prices[tour.slug]! }));
}

/** `Dec 15 – Mar 31`, or `Jul 4` for a single day. Years only when they differ from `today`'s. */
export function formatSeasonDates(s: Pick<SeasonRates, 'startDate' | 'endDate'>, today: string): string {
  const year = today.slice(0, 4);
  const fmt = (iso: string) => {
    const [y, m, d] = iso.split('-').map(Number);
    const label = new Date(Date.UTC(y!, m! - 1, d!)).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    });
    return iso.slice(0, 4) === year ? label : `${label}, ${y}`;
  };
  return s.startDate === s.endDate ? fmt(s.startDate) : `${fmt(s.startDate)} – ${fmt(s.endDate)}`;
}

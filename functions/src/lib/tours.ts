import { db } from './firebase';
import type { RateSeason, Tour, TourTimeSlot } from './types';
import type { SeasonRates } from './pricing';

export async function getTourBySlug(slug: string): Promise<Tour | null> {
  const snap = await db.collection('tours').doc(slug).get();
  if (!snap.exists) return null;
  return snap.data() as Tour;
}

/** Rate seasons covering `date` (`YYYY-MM-DD`), for pricing a booking. */
export async function getRateSeasonsOn(date: string): Promise<SeasonRates[]> {
  const snap = await db.collection('rateSeasons').where('startDate', '<=', date).get();
  return snap.docs
    .map((d) => d.data() as RateSeason)
    .filter((s) => s.endDate >= date)
    .map(({ id, name, startDate, endDate, prices }) => ({ id, name, startDate, endDate, prices }));
}

/** Format an integer-cents amount as `$NN` or `$NN.NN`. */
export function formatPrice(cents: number): string {
  const dollars = cents / 100;
  return dollars % 1 === 0
    ? `$${dollars.toFixed(0)}`
    : `$${dollars.toFixed(2)}`;
}

export const slotLabels: Record<TourTimeSlot, string> = {
  morning: 'Morning',
  'mid-morning': 'Mid-morning',
  'early-afternoon': 'Early afternoon',
  'late-afternoon': 'Late afternoon',
  'whole-day': 'Whole day',
};

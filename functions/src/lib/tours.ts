import { db } from './firebase';
import type { Tour, TourTimeSlot } from './types';

export async function getTourBySlug(slug: string): Promise<Tour | null> {
  const snap = await db.collection('tours').doc(slug).get();
  if (!snap.exists) return null;
  return snap.data() as Tour;
}

/** Format an integer-cents amount as `$NN` or `$NN.NN`. */
export function formatPrice(cents: number): string {
  const dollars = cents / 100;
  return dollars % 1 === 0
    ? `$${dollars.toFixed(0)}`
    : `$${dollars.toFixed(2)}`;
}

export function totalCents(tour: Tour, guestCount: number): number {
  if (tour.type === 'shared' && tour.pricePerPerson != null) {
    return tour.pricePerPerson * guestCount;
  }
  return tour.flatPrice ?? 0;
}

export const slotLabels: Record<TourTimeSlot, string> = {
  morning: 'Morning',
  'mid-morning': 'Mid-morning',
  'early-afternoon': 'Early afternoon',
  'late-afternoon': 'Late afternoon',
  'whole-day': 'Whole day',
};

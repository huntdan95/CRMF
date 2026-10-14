import type { TourTimeSlot } from './types';

/**
 * When each slot's boat leaves, marina time (`HH:MM`). The schedule is code,
 * not something Travis edits (see src/lib/tours.ts and scripts/seed.ts), so
 * checks that only need the departure time don't have to read the tour doc.
 */
export const SLOT_START_TIMES: Record<TourTimeSlot, string> = {
  morning: '08:00',
  'mid-morning': '10:30',
  'early-afternoon': '13:00',
  'late-afternoon': '15:30',
  'whole-day': '07:00',
};

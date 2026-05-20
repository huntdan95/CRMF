/**
 * Static marketing-side tour catalog.
 *
 * Source of truth for:
 *  - Marketing pages (Home, /tours, /tours/[slug])
 *  - Booking flow tour-info display (/book/*)
 *  - Phase 3 seed script (writes a canonical {@link Tour} subset to Firestore)
 *
 * After Phase 4, bookings read availability from Firestore in a transactional
 * Cloud Function. Tour catalog data stays statically generated until the
 * Phase 6 admin editor needs to drive runtime changes.
 *
 * Schedule (America/New_York, confirmed 2026-05-20):
 *   08:00-10:00  morning
 *   10:30-12:30  mid-morning
 *   13:00-15:00  early-afternoon
 *   15:30-17:30  late-afternoon
 *   07:00-15:00  whole-day-private (overlaps every other slot — only bookable
 *                if no other tour is booked that day)
 */
import type { Tour, TourTimeSlot, TourType } from './firebase/types';

/**
 * Marketing-only display extras layered on top of the canonical {@link Tour}.
 * The seed script strips these before writing to Firestore.
 */
export interface MarketingTour extends Tour {
  /** One-sentence subhead used in cards and meta descriptions. */
  shortDescription: string;
  /** Human-readable form of {@link Tour.startTime}, e.g. `8:00 AM`. */
  startTimeDisplay: string;
  /** End-of-tour time in human form, e.g. `10:00 AM`. */
  endTimeDisplay: string;
}

export type { Tour, TourTimeSlot, TourType };

/** Labels used everywhere a time slot is shown in plain English. */
export const slotLabels: Record<TourTimeSlot, string> = {
  morning: 'Morning',
  'mid-morning': 'Mid-morning',
  'early-afternoon': 'Early afternoon',
  'late-afternoon': 'Late afternoon',
  'whole-day': 'Whole day',
};

/** Ordered slot list used by the slot-picker page. */
export const slotOrder: TourTimeSlot[] = [
  'morning',
  'mid-morning',
  'early-afternoon',
  'late-afternoon',
];

export const tours: MarketingTour[] = [
  {
    id: 'morning-shared',
    slug: 'morning-shared',
    name: '2hr Morning Tour — Shared',
    timeSlot: 'morning',
    startTime: '08:00',
    startTimeDisplay: '8:00 AM',
    endTimeDisplay: '10:00 AM',
    durationHours: 2,
    type: 'shared',
    pricePerPerson: 8400,
    flatPrice: null,
    maxGuests: 6,
    shortDescription: 'Quiet water, calm light, the best chance of all-day swims.',
    description:
      'First tour of the day. Manatees are usually at their most relaxed and the springs are at their clearest in the morning — this is the tour for the photo you want to frame.',
    included: [
      'All snorkel gear (mask, snorkel, fins, optional wetsuit)',
      'USCG-licensed captain',
      'Bottled water, towels, and a dry bag',
      'In-water guide who stays with you the whole tour',
    ],
    active: true,
  },
  {
    id: 'morning-private',
    slug: 'morning-private',
    name: '2hr Morning Tour — Private',
    timeSlot: 'morning',
    startTime: '08:00',
    startTimeDisplay: '8:00 AM',
    endTimeDisplay: '10:00 AM',
    durationHours: 2,
    type: 'private',
    pricePerPerson: null,
    flatPrice: 50000,
    maxGuests: 6,
    shortDescription: 'The whole boat to your group. Same morning light, more privacy.',
    description:
      'You and your group get the boat to yourselves. Same morning light, same manatees — no strangers in your photos.',
    included: [
      'Whole-boat charter up to 6 guests',
      'All snorkel gear and wetsuits',
      'Bottled water, towels, and a dry bag',
      'Personal pace — stay longer at one spring, move on faster from another',
    ],
    active: true,
  },
  {
    id: 'mid-morning-shared',
    slug: 'mid-morning-shared',
    name: '2hr Mid-morning Tour — Shared',
    timeSlot: 'mid-morning',
    startTime: '10:30',
    startTimeDisplay: '10:30 AM',
    endTimeDisplay: '12:30 PM',
    durationHours: 2,
    type: 'shared',
    pricePerPerson: 8400,
    flatPrice: null,
    maxGuests: 6,
    shortDescription: "Sun's up, water's warm — our most popular slot.",
    description:
      'The classic Crystal River experience. Springs are warming up, manatees are out and about, and the light underwater is gorgeous for photos and video.',
    included: [
      'All snorkel gear (mask, snorkel, fins, optional wetsuit)',
      'USCG-licensed captain',
      'Bottled water, towels, and a dry bag',
      'In-water guide',
    ],
    active: true,
  },
  {
    id: 'mid-morning-private',
    slug: 'mid-morning-private',
    name: '2hr Mid-morning Tour — Private',
    timeSlot: 'mid-morning',
    startTime: '10:30',
    startTimeDisplay: '10:30 AM',
    endTimeDisplay: '12:30 PM',
    durationHours: 2,
    type: 'private',
    pricePerPerson: null,
    flatPrice: 50000,
    maxGuests: 6,
    shortDescription: 'Most popular slot, just for your group.',
    description:
      "Mid-morning is the easiest sell for travel parties — kids are up, breakfast is done, the water's warming. Book the whole boat to keep the rhythm yours.",
    included: [
      'Whole-boat charter up to 6 guests',
      'All snorkel gear and wetsuits',
      'Bottled water, towels, and a dry bag',
      'Flexible pacing',
    ],
    active: true,
  },
  {
    id: 'early-afternoon-shared',
    slug: 'early-afternoon-shared',
    name: '2hr Early Afternoon Tour — Shared',
    timeSlot: 'early-afternoon',
    startTime: '13:00',
    startTimeDisplay: '1:00 PM',
    endTimeDisplay: '3:00 PM',
    durationHours: 2,
    type: 'shared',
    pricePerPerson: 8400,
    flatPrice: null,
    maxGuests: 6,
    shortDescription: 'The brightest, warmest, sunniest snorkel of the day.',
    description:
      'High-sun light makes the water glow — fantastic for video. Easier wake-up, longer breakfast, same wild manatees.',
    included: [
      'All snorkel gear (mask, snorkel, fins, optional wetsuit)',
      'USCG-licensed captain',
      'Bottled water, towels, and a dry bag',
      'In-water guide',
    ],
    active: true,
  },
  {
    id: 'early-afternoon-private',
    slug: 'early-afternoon-private',
    name: '2hr Early Afternoon Tour — Private',
    timeSlot: 'early-afternoon',
    startTime: '13:00',
    startTimeDisplay: '1:00 PM',
    endTimeDisplay: '3:00 PM',
    durationHours: 2,
    type: 'private',
    pricePerPerson: null,
    flatPrice: 50000,
    maxGuests: 6,
    shortDescription: 'Bright water, just your crew.',
    description:
      'Best light of the day plus the whole boat to yourselves — perfect for family photos and small celebrations.',
    included: [
      'Whole-boat charter up to 6 guests',
      'All snorkel gear and wetsuits',
      'Bottled water, towels, and a dry bag',
      'Flexible pacing',
    ],
    active: true,
  },
  {
    id: 'late-afternoon-shared',
    slug: 'late-afternoon-shared',
    name: '2hr Late Afternoon Tour — Shared',
    timeSlot: 'late-afternoon',
    startTime: '15:30',
    startTimeDisplay: '3:30 PM',
    endTimeDisplay: '5:30 PM',
    durationHours: 2,
    type: 'shared',
    pricePerPerson: 8400,
    flatPrice: null,
    maxGuests: 6,
    shortDescription: 'Late-day light, fewer crowds.',
    description:
      'Most tour operators are off the water by mid-afternoon — that means quieter springs and a softer afternoon glow for your tour.',
    included: [
      'All snorkel gear (mask, snorkel, fins, optional wetsuit)',
      'USCG-licensed captain',
      'Bottled water, towels, and a dry bag',
      'In-water guide',
    ],
    active: true,
  },
  {
    id: 'late-afternoon-private',
    slug: 'late-afternoon-private',
    name: '2hr Late Afternoon Tour — Private',
    timeSlot: 'late-afternoon',
    startTime: '15:30',
    startTimeDisplay: '3:30 PM',
    endTimeDisplay: '5:30 PM',
    durationHours: 2,
    type: 'private',
    pricePerPerson: null,
    flatPrice: 50000,
    maxGuests: 6,
    shortDescription: 'Quiet water, just your group.',
    description:
      'Once the morning rush leaves the springs, the afternoon belongs to whoever stayed. That can be you — just your group, just your captain.',
    included: [
      'Whole-boat charter up to 6 guests',
      'All snorkel gear and wetsuits',
      'Bottled water, towels, and a dry bag',
      'Flexible pacing',
    ],
    active: true,
  },
  {
    id: 'whole-day-private',
    slug: 'whole-day-private',
    name: 'Whole Day Tour — Private',
    timeSlot: 'whole-day',
    startTime: '07:00',
    startTimeDisplay: '7:00 AM',
    endTimeDisplay: '3:00 PM',
    durationHours: 8,
    type: 'private',
    pricePerPerson: null,
    flatPrice: 89500,
    maxGuests: 6,
    shortDescription: 'Sunrise to sunset. Every spring, no rush.',
    description:
      "The full day on the water with your group. We visit every spring at its best light, pause for lunch on the river (bring your own or we'll point you somewhere good), and you go home with the tan and the camera roll.",
    included: [
      'Whole-boat charter up to 6 guests, sunrise to mid-afternoon',
      'All snorkel gear and wetsuits',
      'Bottled water, towels, and a dry bag',
      'Lunch break stop of your choice',
      'Every spring on the river that day',
    ],
    active: true,
  },
];

export function getTourBySlug(slug: string): MarketingTour | undefined {
  return tours.find((t) => t.slug === slug);
}

/** Tours that share a (slot, type)-derived URL slug. */
export function getToursForSlot(slot: TourTimeSlot): MarketingTour[] {
  return tours.filter((t) => t.timeSlot === slot && t.active);
}

export function getFeaturedTours(): MarketingTour[] {
  return [
    tours.find((t) => t.slug === 'morning-shared')!,
    tours.find((t) => t.slug === 'early-afternoon-shared')!,
    tours.find((t) => t.slug === 'whole-day-private')!,
  ];
}

export function formatPrice(cents: number): string {
  const dollars = cents / 100;
  return dollars % 1 === 0
    ? `$${dollars.toFixed(0)}`
    : `$${dollars.toFixed(2)}`;
}

export function formatTourPrice(tour: Tour | MarketingTour): string {
  if (tour.type === 'shared' && tour.pricePerPerson != null) {
    return `${formatPrice(tour.pricePerPerson)}/person`;
  }
  if (tour.flatPrice != null) {
    return `${formatPrice(tour.flatPrice)} flat`;
  }
  return '';
}

/** Total price in cents for a given guest count. */
export function calculateTotalCents(
  tour: Tour | MarketingTour,
  guestCount: number,
): number {
  if (tour.type === 'shared' && tour.pricePerPerson != null) {
    return tour.pricePerPerson * guestCount;
  }
  return tour.flatPrice ?? 0;
}

/**
 * Strips marketing-only fields and returns the canonical Firestore document.
 * Used by the seed script and (eventually) the admin tour-editor.
 */
export function toCanonicalTour(t: MarketingTour): Tour {
  const {
    id,
    slug,
    name,
    timeSlot,
    startTime,
    durationHours,
    type,
    pricePerPerson,
    flatPrice,
    maxGuests,
    description,
    included,
    active,
  } = t;
  return {
    id,
    slug,
    name,
    timeSlot,
    startTime,
    durationHours,
    type,
    pricePerPerson,
    flatPrice,
    maxGuests,
    description,
    included,
    active,
  };
}

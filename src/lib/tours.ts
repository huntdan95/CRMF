/**
 * Static marketing-side tour catalog.
 *
 * Source of truth for:
 *  - Marketing pages (Home, /tours, /tours/[slug])
 *  - Phase 3 seed script (writes a canonical {@link Tour} subset to Firestore)
 *
 * After Phase 4, bookings read tour availability from Firestore. Until the
 * admin tour-editor in Phase 6 is wired up, edits to this file + a re-run of
 * `npm run seed` keep both in sync.
 *
 * Schedule note (2026-05-20): early tour confirmed at 08:00. As written this
 * overlaps the 09:00 morning tour (both 2-hour). The booking transaction in
 * Phase 4 will reject overlapping bookings on the same day; the schedule
 * itself still needs a content decision from the owner.
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
}

export type { Tour, TourTimeSlot, TourType };

export const tours: MarketingTour[] = [
  {
    id: 'early-shared',
    slug: 'early-shared',
    name: '2hr Early Tour — Shared',
    timeSlot: 'early',
    startTime: '08:00',
    startTimeDisplay: '8:00 AM',
    durationHours: 2,
    type: 'shared',
    pricePerPerson: 8400,
    flatPrice: null,
    maxGuests: 6,
    shortDescription: 'Quiet water, calm light, the best chance of all-day swims.',
    description:
      "Be on the water before most boats get out of bed. Manatees are usually at their most relaxed and the springs are at their clearest in the early morning hours — this is the tour for the photo you want to frame.",
    included: [
      'All snorkel gear (mask, snorkel, fins, optional wetsuit)',
      'Florida-fishing-and-wildlife-approved guidance from a USCG-licensed captain',
      'Bottled water, towels, and a dry bag',
      'In-water guide who stays with you the whole tour',
    ],
    active: true,
  },
  {
    id: 'early-private',
    slug: 'early-private',
    name: '2hr Early Tour — Private',
    timeSlot: 'early',
    startTime: '08:00',
    startTimeDisplay: '8:00 AM',
    durationHours: 2,
    type: 'private',
    pricePerPerson: null,
    flatPrice: 50000,
    maxGuests: 6,
    shortDescription: 'The whole boat to your group. Same early light, more privacy.',
    description:
      'You and your group get the boat to yourselves. Same dawn light, same manatees — no strangers in your photos.',
    included: [
      'Whole-boat charter up to 6 guests',
      'All snorkel gear and wetsuits',
      'Bottled water, towels, and a dry bag',
      'Personal pace — stay longer at one spring, move on faster from another',
    ],
    active: true,
  },
  {
    id: 'morning-shared',
    slug: 'morning-shared',
    name: '2hr Morning Tour — Shared',
    timeSlot: 'morning',
    startTime: '09:00',
    startTimeDisplay: '9:00 AM',
    durationHours: 2,
    type: 'shared',
    pricePerPerson: 8400,
    flatPrice: null,
    maxGuests: 6,
    shortDescription: 'Sun\'s up, water\'s warm — our most popular slot.',
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
    id: 'morning-private',
    slug: 'morning-private',
    name: '2hr Morning Tour — Private',
    timeSlot: 'morning',
    startTime: '09:00',
    startTimeDisplay: '9:00 AM',
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
    id: 'midday-shared',
    slug: 'midday-shared',
    name: '2hr Midday Tour — Shared',
    timeSlot: 'midday',
    startTime: '11:30',
    startTimeDisplay: '11:30 AM',
    durationHours: 2,
    type: 'shared',
    pricePerPerson: 8400,
    flatPrice: null,
    maxGuests: 6,
    shortDescription: 'The brightest, warmest, sunniest snorkel of the day.',
    description:
      'High-noon sun makes the water glow — fantastic for video. Easier wake-up, longer breakfast, same wild manatees.',
    included: [
      'All snorkel gear (mask, snorkel, fins, optional wetsuit)',
      'USCG-licensed captain',
      'Bottled water, towels, and a dry bag',
      'In-water guide',
    ],
    active: true,
  },
  {
    id: 'midday-private',
    slug: 'midday-private',
    name: '2hr Midday Tour — Private',
    timeSlot: 'midday',
    startTime: '11:30',
    startTimeDisplay: '11:30 AM',
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
    id: 'afternoon-shared',
    slug: 'afternoon-shared',
    name: '2hr Afternoon Tour — Shared',
    timeSlot: 'afternoon',
    startTime: '14:00',
    startTimeDisplay: '2:00 PM',
    durationHours: 2,
    type: 'shared',
    pricePerPerson: 8400,
    flatPrice: null,
    maxGuests: 6,
    shortDescription: 'Late-day light, fewer crowds.',
    description:
      'Most tour operators are off the water by 1 — that means quieter springs and a softer afternoon glow for your tour.',
    included: [
      'All snorkel gear (mask, snorkel, fins, optional wetsuit)',
      'USCG-licensed captain',
      'Bottled water, towels, and a dry bag',
      'In-water guide',
    ],
    active: true,
  },
  {
    id: 'afternoon-private',
    slug: 'afternoon-private',
    name: '2hr Afternoon Tour — Private',
    timeSlot: 'afternoon',
    startTime: '14:00',
    startTimeDisplay: '2:00 PM',
    durationHours: 2,
    type: 'private',
    pricePerPerson: null,
    flatPrice: 50000,
    maxGuests: 6,
    shortDescription: 'Quiet water, just your group.',
    description:
      "Once the morning rush leaves the springs, the afternoon belongs to whoever stayed. That can be you — just your group, just your captain.",
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

export function getFeaturedTours(): MarketingTour[] {
  return [
    tours.find((t) => t.slug === 'early-shared')!,
    tours.find((t) => t.slug === 'midday-shared')!,
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

/**
 * Strips marketing-only fields and returns the canonical Firestore document.
 * Used by the seed script and (eventually) the admin tour-editor.
 */
export function toCanonicalTour(t: MarketingTour): Tour {
  // Explicit copy so we never accidentally persist a marketing-extra field.
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

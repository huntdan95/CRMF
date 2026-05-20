/**
 * Static tour catalog for marketing pages.
 *
 * Phase 3 replaces these reads with a Firestore `tours` collection. The shape
 * here is intentionally a subset of the eventual `Tour` doc — prices stored
 * in cents to match the Stripe / Firestore representation we'll use.
 *
 * Schedule note (2026-05-20): the early tour was confirmed at 08:00. That
 * means it overlaps the morning slot (09:00, 2-hour duration). Resolve the
 * schedule before seeding the real `tours` collection in Phase 3.
 */
export type TimeSlot = 'early' | 'morning' | 'midday' | 'afternoon' | 'whole-day';
export type TourType = 'shared' | 'private';

export interface Tour {
  slug: string;
  name: string;
  timeSlot: TimeSlot;
  /** 24-hour local time, e.g. "08:00". */
  startTime: string;
  /** Human-readable start time, e.g. "8:00 AM". */
  startTimeDisplay: string;
  durationHours: number;
  type: TourType;
  /** Cents per person; null for private tours. */
  pricePerPerson: number | null;
  /** Cents flat for the whole boat; null for shared tours. */
  flatPrice: number | null;
  maxGuests: number;
  shortDescription: string;
  description: string;
  included: string[];
  active: boolean;
}

export const tours: Tour[] = [
  {
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
      'The full day on the water with your group. We visit every spring at its best light, pause for lunch on the river (bring your own or we\'ll point you somewhere good), and you go home with the tan and the camera roll.',
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

export function getTourBySlug(slug: string): Tour | undefined {
  return tours.find((t) => t.slug === slug);
}

export function getFeaturedTours(): Tour[] {
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

export function formatTourPrice(tour: Tour): string {
  if (tour.type === 'shared' && tour.pricePerPerson != null) {
    return `${formatPrice(tour.pricePerPerson)}/person`;
  }
  if (tour.flatPrice != null) {
    return `${formatPrice(tour.flatPrice)} flat`;
  }
  return '';
}

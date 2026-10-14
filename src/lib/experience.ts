/**
 * What a tour is like, in the words we use everywhere: the home page, the
 * tours pages, and the booking summary. Facts here come from the FAQ and
 * the booking confirmation; keep them in step if either changes.
 */
import { slotLabels, type MarketingTour } from './tours';

export const tourSteps = [
  {
    title: 'Meet at Pete’s Pier',
    body: 'Park and meet in the Pete’s Pier parking lot 20 to 30 minutes before your departure. Parking is free, and there’s a restroom.',
  },
  {
    title: 'Suit up and learn the rules',
    body: 'Wetsuits are set aside ahead of time in the sizes you pick when you book. Before anyone gets in, Travis goes over the USFWS manatee rules on the boat.',
  },
  {
    title: 'In the water with Travis',
    body: 'The springs hold at 72°F all year, and where the manatees rest it’s usually six to eight feet deep. Your wetsuit floats you; Travis stays with your group the whole time.',
  },
  {
    title: 'Hot chocolate on the ride back',
    body: 'Water and hot chocolate on board. Travis shoots the highlights on an underwater GoPro and sends you the photos, free.',
  },
];

/** Short names for people, not for Stripe receipts ("Morning tour, shared boat"). */
export function tourDisplayName(tour: MarketingTour): string {
  if (tour.timeSlot === 'whole-day') return 'Whole-day private charter';
  return `${slotLabels[tour.timeSlot]} tour, ${tour.type === 'shared' ? 'shared boat' : 'private boat'}`;
}

export function boatLabel(tour: MarketingTour): string {
  if (tour.timeSlot === 'whole-day') return 'Private, whole day';
  return tour.type === 'shared' ? 'Shared boat' : 'Private boat';
}

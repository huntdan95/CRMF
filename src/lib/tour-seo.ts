/**
 * Search-result titles and meta descriptions for the tour pages, built from
 * each tour's own data (type, time, length, price) so they can't drift from
 * the schedule. The tour's name and blurb are Travis's to edit in Admin →
 * Tours and stay on the page; search results get these instead, which lead
 * with what people search for: swimming with manatees in Crystal River.
 */
import { siteConfig } from './site-config';
import { formatPriceRange, type PriceRange } from './pricing';
import type { MarketingTour } from './tours';

/** Past about this, Google cuts the title off; the price goes first. */
const MAX_TITLE = 65;

/** e.g. `Shared Manatee Snorkel Tour, 8:00 AM — $84 each | Crystal River` */
export function tourSeoTitle(tour: MarketingTour, range: PriceRange | null): string {
  const head =
    tour.timeSlot === 'whole-day'
      ? 'Whole-Day Private Manatee Snorkel Tour'
      : `${tour.type === 'shared' ? 'Shared' : 'Private'} Manatee Snorkel Tour, ${tour.startTimeDisplay}`;
  const price = formatPriceRange(range);
  const priced = price && `${head} — ${price}${tour.type === 'shared' ? ' each' : ''} | Crystal River`;
  return priced && priced.length <= MAX_TITLE ? priced : `${head} | Crystal River`;
}

/** 140–160 characters: where, how long, when, how much, what's included. */
export function tourMetaDescription(tour: MarketingTour, range: PriceRange | null): string {
  const marina = siteConfig.marina.name;
  const price = formatPriceRange(range, { capitalize: true });

  if (tour.timeSlot === 'whole-day') {
    return [
      `Swim with manatees in Crystal River all day on a private charter from ${marina},`,
      `${tour.startTimeDisplay} to ${tour.endTimeDisplay}.`,
      price && `${price} for up to ${tour.maxGuests} guests, gear included.`,
    ].filter(Boolean).join(' ');
  }

  const kind = tour.type === 'shared' ? 'shared' : 'private';
  return [
    `Swim with manatees in Crystal River on a ${tour.durationHours}-hour ${kind} snorkel tour`,
    `from ${marina} at ${tour.startTimeDisplay}.`,
    price &&
      (tour.type === 'shared'
        ? `${price} per person, wetsuit and snorkel gear included.`
        : `${price} for the whole boat (up to ${tour.maxGuests}), gear included.`),
  ].filter(Boolean).join(' ');
}

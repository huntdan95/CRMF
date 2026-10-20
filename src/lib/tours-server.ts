import 'server-only';
import { cache } from 'react';
import { adminDb } from './firebase/admin';
import type { RateSeason, Tour } from './firebase/types';
import { addDaysIso, marinaNow } from './availability';
import type { SeasonRates } from './pricing';
import { tours as builtInTours, type MarketingTour } from './tours';

export interface TourCatalog {
  tours: MarketingTour[];
  /**
   * Rate seasons that haven't ended yet, and those that ended in the last
   * week. Use the upcoming* helpers in ./pricing for "from" prices; they
   * leave out the ended ones.
   */
  seasons: SeasonRates[];
}

/** What Travis edits in Admin → Tours. Everything else (schedule, slots) stays in src/lib/tours.ts. */
function applyEdits(base: MarketingTour, doc: Partial<Tour> | undefined): MarketingTour {
  if (!doc) return base;
  const text = (v: unknown, fallback: string) => (typeof v === 'string' && v.trim() ? v : fallback);
  const cents = (v: unknown, fallback: number | null) =>
    v === null || (typeof v === 'number' && Number.isInteger(v) && v >= 0) ? (v as number | null) : fallback;
  return {
    ...base,
    name: text(doc.name, base.name),
    description: text(doc.description, base.description),
    included:
      Array.isArray(doc.included) && doc.included.every((i) => typeof i === 'string')
        ? doc.included
        : base.included,
    pricePerPerson: cents(doc.pricePerPerson, base.pricePerPerson),
    flatPrice: cents(doc.flatPrice, base.flatPrice),
    active: typeof doc.active === 'boolean' ? doc.active : base.active,
  };
}

/**
 * The tour catalog as Travis has it: the built-in schedule from
 * src/lib/tours.ts with his edits from the `tours` collection laid over it,
 * plus his seasonal rates. Falls back to the built-in catalog if Firestore
 * can't be reached, so a page never fails over prices. Pages that use this
 * revalidate every 60 seconds, and the admin functions that change tours or
 * rate seasons also refresh them on the spot (POST /api/revalidate).
 */
export const fetchTourCatalog = cache(async (): Promise<TourCatalog> => {
  try {
    const db = adminDb();
    // A week back, not just today: a customer can move a booking Travis
    // closed until a few days after its date, and the move dialog prices
    // the old booking at its own date's rate, as moveClosedBooking does.
    const since = addDaysIso(marinaNow().date, -7);
    const [tourSnap, seasonSnap] = await Promise.all([
      db.collection('tours').get(),
      db.collection('rateSeasons').where('endDate', '>=', since).get(),
    ]);
    const edits = new Map(tourSnap.docs.map((d) => [d.id, d.data() as Partial<Tour>]));
    return {
      tours: builtInTours.map((t) => applyEdits(t, edits.get(t.slug))),
      seasons: seasonSnap.docs.map((d) => {
        const { id, name, startDate, endDate, prices } = d.data() as RateSeason;
        return { id: id ?? d.id, name, startDate, endDate, prices: prices ?? {} };
      }),
    };
  } catch (err) {
    // Checkout still charges the Firestore prices, so this needs noticing.
    console.error('Tour catalog: Firestore read failed, showing built-in tours and prices', err);
    return { tours: builtInTours, seasons: [] };
  }
});

export function findTour(catalog: TourCatalog, slug: string): MarketingTour | undefined {
  return catalog.tours.find((t) => t.slug === slug);
}

'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { tours as builtInTours, type MarketingTour } from '@/lib/tours';
import type { SeasonRates } from '@/lib/pricing';

export interface TourCatalogValue {
  tours: MarketingTour[];
  seasons: SeasonRates[];
}

// Outside a provider (shouldn't happen on public pages), the built-in
// catalog at standard prices.
const TourCatalogContext = createContext<TourCatalogValue>({ tours: builtInTours, seasons: [] });

/**
 * Hands the live catalog (Travis's prices, names, Active switches and
 * seasonal rates, read on the server by fetchTourCatalog) to the client
 * components under the marketing and booking layouts.
 */
export function TourCatalogProvider({ catalog, children }: { catalog: TourCatalogValue; children: ReactNode }) {
  return <TourCatalogContext.Provider value={catalog}>{children}</TourCatalogContext.Provider>;
}

export function useTourCatalog(): TourCatalogValue {
  return useContext(TourCatalogContext);
}

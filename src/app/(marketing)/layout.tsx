import type { ReactNode } from 'react';
import { Header } from '@/components/marketing/Header';
import { Footer } from '@/components/marketing/Footer';
import { MobileBottomBar } from '@/components/marketing/MobileBottomBar';
import { TourCatalogProvider } from '@/components/TourCatalog';
import { fetchTourCatalog } from '@/lib/tours-server';

// Prices, tour names and Active switches come from Admin → Tours.
export const revalidate = 60;

export default async function MarketingLayout({ children }: { children: ReactNode }) {
  const catalog = await fetchTourCatalog();
  return (
    <TourCatalogProvider catalog={catalog}>
      <Header />
      <main className="flex-1">{children}</main>
      <Footer />
      {/* Room under the footer for the fixed phone bar, in the footer's
          color, so the bar never covers the footer's last links. */}
      <div aria-hidden className="h-[calc(4.25rem+env(safe-area-inset-bottom))] bg-[var(--color-ink)] lg:hidden" />
      <MobileBottomBar />
    </TourCatalogProvider>
  );
}

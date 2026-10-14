import type { ReactNode } from 'react';
import { Header } from '@/components/marketing/Header';
import { Footer } from '@/components/marketing/Footer';
import { MobileBottomBar } from '@/components/marketing/MobileBottomBar';

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <Header />
      <main className="flex-1">{children}</main>
      <Footer />
      {/* Room under the footer for the fixed phone bar, in the footer's
          color, so the bar never covers the footer's last links. */}
      <div aria-hidden className="h-[calc(4.25rem+env(safe-area-inset-bottom))] bg-[var(--color-ink)] lg:hidden" />
      <MobileBottomBar />
    </>
  );
}

'use client';

import { usePathname } from 'next/navigation';

/** Room under the footer for /book's fixed phone summary bar. */
export function BookingFooterSpacer() {
  const pathname = usePathname();
  if (pathname !== '/book') return null;
  return <div aria-hidden className="h-[calc(5.25rem+env(safe-area-inset-bottom))] lg:hidden" />;
}

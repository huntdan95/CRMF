import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

/**
 * The crew app: Travis's swim guides and mates add /crew to their home
 * screen to see confirmed tours and get booking notifications. It has its
 * own manifest so the home-screen app opens here, not on the marketing
 * homepage.
 */
export const metadata: Metadata = {
  title: {
    default: 'Crew schedule',
    template: '%s | Manatee Crew',
  },
  robots: { index: false, follow: false },
  manifest: '/crew/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    title: 'Manatee Crew',
    statusBarStyle: 'black-translucent',
  },
};

// Lets the dark header run up under the iPhone status bar; pages pad
// themselves with env(safe-area-inset-*).
export const viewport: Viewport = {
  themeColor: '#0D3532',
  viewportFit: 'cover',
};

export default function CrewLayout({ children }: { children: ReactNode }) {
  return children;
}

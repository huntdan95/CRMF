import type { Metadata, Viewport } from 'next';
import { Archivo } from 'next/font/google';
import { AnalyticsBootstrap } from '@/components/AnalyticsBootstrap';
import './globals.css';

// One family, two widths: expanded for headlines, normal for everything
// else. Variable on both axes, so it's a single font file.
const archivo = Archivo({
  variable: '--font-archivo',
  subsets: ['latin'],
  display: 'swap',
  axes: ['wdth'],
});

export const metadata: Metadata = {
  metadataBase: new URL('https://crystalrivermanateefun.com'),
  applicationName: 'Crystal River Manatee Fun',
  title: {
    // Both target searches: "swim with manatees Crystal River" and
    // "manatee tours".
    default: 'Swim with Manatees in Crystal River, FL | Manatee Tours',
    template: '%s | Crystal River Manatee Fun',
  },
  description:
    "Swim with manatees in Crystal River, FL on a shared or private 2-hour snorkel tour with USCG-licensed Capt. Travis from Pete's Pier Marina. Six guests max.",
  keywords: [
    'crystal river manatee tours',
    'swim with manatees florida',
    'manatee snorkel tour',
    'crystal river florida',
    'three sisters springs',
    'captain travis urbin',
  ],
  authors: [{ name: 'Capt. Travis Urbin' }],
  creator: 'Crystal River Manatee Fun',
  publisher: 'Crystal River Manatee Fun',
  formatDetection: { telephone: true, email: false, address: true },
  // No `url` and no `alternates.canonical` here: every page would inherit
  // them and point Google at the homepage. Indexable pages set their own
  // with pageSeo() from src/lib/seo.ts.
  openGraph: {
    type: 'website',
    locale: 'en_US',
    siteName: 'Crystal River Manatee Fun',
    title: 'Crystal River Manatee Fun — Guided Manatee Tours',
    description:
      "Small-group, family-friendly snorkel-with-manatee tours from Pete's Pier Marina in Crystal River, Florida.",
    // `images` is auto-populated by Next.js from src/app/opengraph-image.tsx
  },
  twitter: {
    card: 'summary_large_image',
    // No title or description here: every page would inherit them. Left
    // out, Next fills them (and the image) from each page's openGraph.
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
};

export const viewport: Viewport = {
  themeColor: '#0D3532',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${archivo.variable} h-full antialiased`}
      // Lets Next turn smooth scrolling off during route changes.
      data-scroll-behavior="smooth"
    >
      <body className="min-h-full flex flex-col bg-[var(--color-paper)] text-[var(--color-ink)]">
        <AnalyticsBootstrap />
        {children}
      </body>
    </html>
  );
}

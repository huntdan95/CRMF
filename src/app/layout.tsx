import type { Metadata, Viewport } from 'next';
import { Fraunces, Inter } from 'next/font/google';
import { AnalyticsBootstrap } from '@/components/AnalyticsBootstrap';
import './globals.css';

const fraunces = Fraunces({
  variable: '--font-fraunces',
  subsets: ['latin'],
  display: 'swap',
  axes: ['SOFT', 'WONK'],
});

const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
  display: 'swap',
});

export const metadata: Metadata = {
  metadataBase: new URL('https://crystalrivermanateefun.com'),
  applicationName: 'Crystal River Manatee Fun',
  title: {
    default: 'Crystal River Manatee Fun — Guided Manatee Tours with Capt. Travis',
    template: '%s | Crystal River Manatee Fun',
  },
  description:
    "Small-group, family-friendly snorkel-with-manatee tours from Pete's Pier Marina in Crystal River, Florida. Captained by Travis Urbin.",
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
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: 'https://crystalrivermanateefun.com',
    siteName: 'Crystal River Manatee Fun',
    title: 'Crystal River Manatee Fun — Guided Manatee Tours',
    description:
      "Small-group, family-friendly snorkel-with-manatee tours from Pete's Pier Marina in Crystal River, Florida.",
    // `images` is auto-populated by Next.js from src/app/opengraph-image.tsx
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Crystal River Manatee Fun',
    description: 'Snorkel with wild manatees in Crystal River, Florida.',
    // Twitter pulls its preview from the same Next.js-generated OG image.
  },
  alternates: {
    canonical: 'https://crystalrivermanateefun.com',
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
  themeColor: '#1B6FA8',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${fraunces.variable} ${inter.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-[var(--color-cream)] text-[var(--color-ink)]">
        <AnalyticsBootstrap />
        {children}
      </body>
    </html>
  );
}

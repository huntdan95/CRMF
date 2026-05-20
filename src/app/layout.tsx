import type { Metadata, Viewport } from 'next';
import { Fraunces, Inter } from 'next/font/google';
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
  title: {
    default: 'Crystal River Manatee Fun — Guided Manatee Tours with Capt. Travis',
    template: '%s | Crystal River Manatee Fun',
  },
  description:
    'Small-group, family-friendly snorkel-with-manatee tours from Pete\'s Pier Marina in Crystal River, Florida. Captained by lifelong local Travis Urbin.',
  keywords: [
    'crystal river manatee tours',
    'swim with manatees florida',
    'manatee snorkel tour',
    'crystal river florida',
    'three sisters springs',
    'captain travis urbin',
  ],
  authors: [{ name: 'Capt. Travis Urbin' }],
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: 'https://crystalrivermanateefun.com',
    siteName: 'Crystal River Manatee Fun',
    title: 'Crystal River Manatee Fun — Guided Manatee Tours',
    description:
      'Small-group, family-friendly snorkel-with-manatee tours from Pete\'s Pier Marina in Crystal River, Florida.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Crystal River Manatee Fun',
    description: 'Snorkel with wild manatees in Crystal River, Florida.',
  },
  alternates: {
    canonical: 'https://crystalrivermanateefun.com',
  },
  robots: {
    index: true,
    follow: true,
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
        {children}
      </body>
    </html>
  );
}

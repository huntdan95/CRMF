import type { MetadataRoute } from 'next';
import { headers } from 'next/headers';
import { namesProductionHost } from '@/lib/host';
import { siteConfig } from '@/lib/site-config';

export default async function robots(): Promise<MetadataRoute.Robots> {
  // The App Hosting staging URL (and localhost) must never be indexed — it
  // would compete with the real domain. The proxy marks every response there
  // `X-Robots-Tag: noindex`, and Google only sees that on pages it may
  // crawl: a `Disallow` here would leave any staging URL it already has
  // stuck in its index as "blocked by robots.txt". So staging allows
  // crawling, and lists no sitemap.
  if (!namesProductionHost(await headers())) {
    return { rules: [{ userAgent: '*', allow: '/' }] };
  }

  return {
    rules: [
      {
        userAgent: '*',
        // The login page is crawlable only so Google can see its noindex:
        // the footer links to it from every page, and a blocked URL with
        // inbound links gets indexed anyway, without content.
        allow: ['/', '/admin/login'],
        // Booking flow and admin should never be indexed.
        disallow: ['/admin', '/admin/', '/my-booking', '/book/confirmation'],
      },
    ],
    sitemap: `${siteConfig.url}/sitemap.xml`,
    host: siteConfig.url,
  };
}

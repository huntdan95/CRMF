import type { MetadataRoute } from 'next';
import { headers } from 'next/headers';
import { PRODUCTION_HOST, hostFromHeaders } from '@/lib/host';
import { siteConfig } from '@/lib/site-config';

export default async function robots(): Promise<MetadataRoute.Robots> {
  // The App Hosting staging URL (and localhost) must never be crawled —
  // it would compete with the real domain.
  const host = hostFromHeaders(await headers());
  if (host !== PRODUCTION_HOST) {
    return { rules: [{ userAgent: '*', disallow: '/' }] };
  }

  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        // Booking flow and admin should never be indexed.
        disallow: ['/admin', '/admin/', '/my-booking', '/book/confirmation'],
      },
    ],
    sitemap: `${siteConfig.url}/sitemap.xml`,
    host: siteConfig.url,
  };
}

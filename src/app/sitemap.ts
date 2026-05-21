import type { MetadataRoute } from 'next';
import { tours } from '@/lib/tours';
import { siteConfig } from '@/lib/site-config';

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${siteConfig.url}/`, lastModified: now, priority: 1.0, changeFrequency: 'weekly' },
    { url: `${siteConfig.url}/tours`, lastModified: now, priority: 0.9, changeFrequency: 'weekly' },
    { url: `${siteConfig.url}/about`, lastModified: now, priority: 0.8, changeFrequency: 'monthly' },
    { url: `${siteConfig.url}/reviews`, lastModified: now, priority: 0.7, changeFrequency: 'weekly' },
    { url: `${siteConfig.url}/gallery`, lastModified: now, priority: 0.6, changeFrequency: 'monthly' },
    { url: `${siteConfig.url}/faq`, lastModified: now, priority: 0.7, changeFrequency: 'monthly' },
    { url: `${siteConfig.url}/contact`, lastModified: now, priority: 0.7, changeFrequency: 'monthly' },
    { url: `${siteConfig.url}/cancellation-policy`, lastModified: now, priority: 0.5, changeFrequency: 'monthly' },
    { url: `${siteConfig.url}/privacy`, lastModified: now, priority: 0.3, changeFrequency: 'yearly' },
    { url: `${siteConfig.url}/terms`, lastModified: now, priority: 0.3, changeFrequency: 'yearly' },
  ];
  const tourRoutes: MetadataRoute.Sitemap = tours
    .filter((t) => t.active)
    .map((t) => ({
      url: `${siteConfig.url}/tours/${t.slug}`,
      lastModified: now,
      priority: 0.8,
      changeFrequency: 'monthly',
    }));
  return [...staticRoutes, ...tourRoutes];
}

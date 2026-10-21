import type { MetadataRoute } from 'next';
import { fetchTourCatalog } from '@/lib/tours-server';
import { getAllPosts } from '@/lib/news';
import { siteConfig } from '@/lib/site-config';

// Tours Travis has switched off (Admin → Tours) drop out within the hour.
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const { tours } = await fetchTourCatalog();
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
    // The waiver to read before booking, where the old /liability-waiver-example/ now lands.
    { url: `${siteConfig.url}/waiver`, lastModified: now, priority: 0.4, changeFrequency: 'yearly' },
    { url: `${siteConfig.url}/privacy`, lastModified: now, priority: 0.3, changeFrequency: 'yearly' },
    { url: `${siteConfig.url}/terms`, lastModified: now, priority: 0.3, changeFrequency: 'yearly' },
  ];
  // Posts use their real dates so Google doesn't see them all as changed
  // on every deploy; the index changes when the newest post does.
  const posts = await getAllPosts();
  const newsRoutes: MetadataRoute.Sitemap = [
    {
      url: `${siteConfig.url}/news`,
      lastModified: posts.length ? new Date(posts[0].date) : now,
      priority: 0.6,
      changeFrequency: 'monthly',
    },
    ...posts.map((p) => ({
      url: `${siteConfig.url}/news/${p.slug}`,
      lastModified: new Date(p.modified),
      priority: 0.5,
      changeFrequency: 'yearly' as const,
    })),
  ];
  const tourRoutes: MetadataRoute.Sitemap = tours
    .filter((t) => t.active)
    .map((t) => ({
      url: `${siteConfig.url}/tours/${t.slug}`,
      lastModified: now,
      priority: 0.8,
      changeFrequency: 'monthly',
    }));
  return [...staticRoutes, ...tourRoutes, ...newsRoutes];
}

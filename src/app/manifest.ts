import type { MetadataRoute } from 'next';
import { siteConfig } from '@/lib/site-config';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: siteConfig.name,
    short_name: 'Manatee Fun',
    description:
      "Small-group, family-friendly snorkel-with-manatee tours from Pete's Pier Marina in Crystal River, Florida.",
    start_url: '/',
    display: 'standalone',
    background_color: '#F5EDD8',
    theme_color: '#1B6FA8',
    orientation: 'portrait',
    categories: ['travel', 'outdoors', 'lifestyle'],
    icons: [
      // TODO: replace with brand-painted icons in public/icons/
      // 192×192 and 512×512 are the minimum set for installability.
      { src: '/favicon.ico', sizes: 'any', type: 'image/x-icon' },
    ],
  };
}

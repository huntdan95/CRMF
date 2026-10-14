import type { MetadataRoute } from 'next';

export const dynamic = 'force-static';

/**
 * Web app manifest for the crew app (linked from src/app/crew/layout.tsx).
 * Separate from the site's /manifest.webmanifest so "Add to Home Screen"
 * on /crew installs an app that opens on the crew schedule.
 */
export function GET() {
  const manifest: MetadataRoute.Manifest = {
    id: '/crew',
    name: 'Manatee Fun Crew',
    short_name: 'Manatee Crew',
    description: 'Confirmed Crystal River Manatee Fun tours, for the crew.',
    start_url: '/crew',
    scope: '/crew',
    display: 'standalone',
    background_color: '#F4F2EC',
    theme_color: '#0D3532',
    orientation: 'portrait',
    icons: [
      { src: '/apple-icon', sizes: '180x180', type: 'image/png' },
      { src: '/crew/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  };
  return new Response(JSON.stringify(manifest), {
    headers: { 'Content-Type': 'application/manifest+json' },
  });
}

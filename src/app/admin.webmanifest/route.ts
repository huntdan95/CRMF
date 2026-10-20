import type { MetadataRoute } from 'next';

export const dynamic = 'force-static';

/**
 * Web app manifest for Travis's admin app (linked from
 * src/app/admin/layout.tsx). "Add to Home Screen" on any admin page installs
 * an app that opens on the admin dashboard, which is what iOS needs before
 * it allows push notifications (Admin → Settings → Notifications).
 *
 * Served at /admin.webmanifest, outside /admin/*, so the browser can fetch
 * it without the admin session cookie (src/proxy.ts sends cookie-less
 * /admin/* requests to the sign-in page).
 */
export function GET() {
  const manifest: MetadataRoute.Manifest = {
    id: '/admin',
    name: 'Manatee Fun Admin',
    short_name: 'Manatee Admin',
    description: 'Bookings, messages and the day’s trips for Crystal River Manatee Fun.',
    start_url: '/admin',
    scope: '/admin',
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

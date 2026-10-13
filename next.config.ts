import type { NextConfig } from 'next';
import { buildLegacyRedirects } from './src/lib/legacy-redirects';

const nextConfig: NextConfig = {
  /**
   * Permanent redirects for every URL in the old WordPress site's sitemaps,
   * plus catch-alls for WordPress URL shapes that weren't in it. The list
   * lives in src/lib/legacy-redirects.ts so `npm run check:redirects` can
   * verify it. Add to it as old URLs show up in Search Console's 404 report.
   */
  async redirects() {
    return buildLegacyRedirects();
  },

  // App Hosting build images don't need source maps in production.
  productionBrowserSourceMaps: false,

  // Allow next/image to optimize photos served from Firebase Storage
  // (the admin-uploaded site photos at `siteImages/{slot}.downloadUrl`).
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'firebasestorage.googleapis.com',
        pathname: '/v0/b/**',
      },
      {
        protocol: 'https',
        hostname: 'storage.googleapis.com',
        pathname: '/**',
      },
    ],
  },

  // Tighten security headers a little. App Hosting applies its own as well.
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          // Permissions-Policy intentionally minimal — we use the camera /
          // mic for nothing on the marketing or booking flow.
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;

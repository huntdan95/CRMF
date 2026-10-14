import type { NextConfig } from 'next';
import { buildLegacyRedirects } from './src/lib/legacy-redirects';
import { tours } from './src/lib/tours';

/**
 * The booking flow is one page now (/book, state in the query string).
 * These keep the old step URLs working as real HTTP redirects. Temporary
 * (307), and the incoming query string is passed through, so Stripe's
 * cancel URL — /book/<date>/<slug>?cancelled=1, set in
 * functions/src/createCheckoutSession.ts — keeps its ?cancelled=1.
 */
const DATE = ':date(\\d{4}-\\d{2}-\\d{2})';
const bookingRedirects = [
  { source: `/book/${DATE}/:slug`, destination: '/book?date=:date&tour=:slug&step=details', permanent: false },
  { source: `/book/${DATE}`, destination: '/book?date=:date', permanent: false },
  {
    source: `/book/:slug(${tours.map((t) => t.slug).join('|')})`,
    destination: '/book?tour=:slug',
    permanent: false,
  },
];

/**
 * Firebase's Google sign-in helper pages, served from this site's own host
 * so sign-in never needs another site's storage. See authDomain() in
 * src/lib/firebase/client.ts.
 */
const firebaseAuthHost = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN;
const authHelperRewrites = firebaseAuthHost
  ? [
      { source: '/__/auth/:path*', destination: `https://${firebaseAuthHost}/__/auth/:path*` },
      { source: '/__/firebase/:path*', destination: `https://${firebaseAuthHost}/__/firebase/:path*` },
    ]
  : [];

const nextConfig: NextConfig = {
  /**
   * Permanent redirects for every URL in the old WordPress site's sitemaps,
   * plus catch-alls for WordPress URL shapes that weren't in it. The list
   * lives in src/lib/legacy-redirects.ts so `npm run check:redirects` can
   * verify it. Add to it as old URLs show up in Search Console's 404 report.
   */
  async redirects() {
    return [...buildLegacyRedirects(), ...bookingRedirects];
  },

  async rewrites() {
    return authHelperRewrites;
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
      // Pages whose URL carries a booking's access token (?t=). With the
      // default policy, the next page on this site would get the full URL
      // as its referrer, and Analytics there records it. Listed after the
      // site-wide rule so this value wins.
      ...['/my-booking/:path*', '/book/confirmation/:path*', '/feedback/:path*'].map((source) => ({
        source,
        headers: [{ key: 'Referrer-Policy', value: 'no-referrer' }],
      })),
    ];
  },
};

export default nextConfig;

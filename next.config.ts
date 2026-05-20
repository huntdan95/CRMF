import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  /**
   * 301 redirects for legacy WordPress URLs that may be indexed by Google or
   * linked from external sites. These all permanent-redirect to the closest
   * new equivalent. Add more as the owner finds 404s in Search Console.
   *
   * TODO (owner): pull the actual list of old URLs from the WordPress admin
   * and confirm each maps to the right new page.
   */
  async redirects() {
    return [
      // WooCommerce product pages → new tour pages
      { source: '/product/early-tour-shared', destination: '/tours/morning-shared', permanent: true },
      { source: '/product/early-tour-private', destination: '/tours/morning-private', permanent: true },
      { source: '/product/3hr-morning-tour-private', destination: '/tours/morning-private', permanent: true },
      { source: '/product/morning-tour-shared', destination: '/tours/mid-morning-shared', permanent: true },
      { source: '/product/morning-tour-private', destination: '/tours/mid-morning-private', permanent: true },
      { source: '/product/midday-tour-shared', destination: '/tours/early-afternoon-shared', permanent: true },
      { source: '/product/midday-tour-private', destination: '/tours/early-afternoon-private', permanent: true },
      { source: '/product/afternoon-tour-shared', destination: '/tours/late-afternoon-shared', permanent: true },
      { source: '/product/afternoon-tour-private', destination: '/tours/late-afternoon-private', permanent: true },
      { source: '/product/whole-day-private', destination: '/tours/whole-day-private', permanent: true },
      // Common WordPress pages
      { source: '/product-category/:slug*', destination: '/tours', permanent: true },
      { source: '/shop', destination: '/tours', permanent: true },
      { source: '/about-us', destination: '/captain', permanent: true },
      { source: '/about', destination: '/captain', permanent: true },
      { source: '/captain-travis', destination: '/captain', permanent: true },
      { source: '/contact-us', destination: '/contact', permanent: true },
      { source: '/blog/:slug*', destination: '/crystal-river', permanent: false },
      // Cart / checkout pages — bookings go through Stripe now
      { source: '/cart', destination: '/book', permanent: true },
      { source: '/checkout', destination: '/book', permanent: true },
      { source: '/my-account/:path*', destination: '/contact', permanent: false },
    ];
  },

  // App Hosting build images don't need source maps in production.
  productionBrowserSourceMaps: false,

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

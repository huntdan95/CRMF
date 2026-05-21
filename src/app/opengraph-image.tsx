import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt = 'Crystal River Manatee Fun — Swim with wild manatees';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/**
 * Default Open Graph card for the site.
 *
 * Brand-blue gradient with the headline + sub. No real photo dependency
 * (renders identically on first load before any photos are uploaded).
 * Next.js wires this to <meta property="og:image"> automatically.
 */
export default async function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'flex-start',
          padding: '80px 96px',
          background:
            'linear-gradient(140deg, #1B6FA8 0%, #145582 55%, #0F3D5F 100%)',
          color: '#F5EDD8',
          fontFamily:
            'ui-serif, Georgia, Cambria, "Times New Roman", Times, serif',
        }}
      >
        {/* Eyebrow */}
        <div
          style={{
            fontSize: 28,
            letterSpacing: 6,
            textTransform: 'uppercase',
            color: 'rgba(245,237,216,0.85)',
            fontFamily:
              'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
          }}
        >
          Crystal River · Florida
        </div>

        {/* Headline */}
        <div
          style={{
            fontSize: 116,
            lineHeight: 1.0,
            letterSpacing: -2,
            marginTop: 28,
            color: '#FFFFFF',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <span>Swim with</span>
          <span style={{ color: '#F5EDD8' }}>wild manatees.</span>
        </div>

        {/* Footer line */}
        <div
          style={{
            marginTop: 56,
            fontSize: 24,
            color: 'rgba(245,237,216,0.9)',
            fontFamily:
              'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
            display: 'flex',
            alignItems: 'center',
            gap: 18,
          }}
        >
          <span>With Capt. Travis Urbin</span>
          <span style={{ color: 'rgba(245,237,216,0.4)' }}>·</span>
          <span>crystalrivermanateefun.com</span>
        </div>

        {/* Coral accent bar */}
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            height: 14,
            background: '#E08266',
          }}
        />
      </div>
    ),
    {
      ...size,
    },
  );
}

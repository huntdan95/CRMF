import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

/**
 * iOS home-screen icon when a user "Add to Home Screen"s the site.
 * Same monogram as the favicon, just rendered at apple-touch size.
 */
export default async function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          background:
            'linear-gradient(135deg, #1B6FA8 0%, #0F3D5F 100%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#F5EDD8',
          fontFamily:
            'ui-serif, Georgia, Cambria, "Times New Roman", Times, serif',
          fontWeight: 700,
          fontSize: 132,
          letterSpacing: -4,
        }}
      >
        M
      </div>
    ),
    {
      ...size,
    },
  );
}

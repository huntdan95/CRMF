import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const size = { width: 64, height: 64 };
export const contentType = 'image/png';

/**
 * Browser tab favicon — a brand-blue rounded square with a cream "M"
 * monogram. Renders crisply at 16×16 since the form is simple.
 */
export default async function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          background:
            'linear-gradient(135deg, #1B6FA8 0%, #145582 100%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#F5EDD8',
          fontFamily:
            'ui-serif, Georgia, Cambria, "Times New Roman", Times, serif',
          fontWeight: 700,
          fontSize: 48,
          letterSpacing: -2,
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

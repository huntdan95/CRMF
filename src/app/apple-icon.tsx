import { ImageResponse } from 'next/og';
import { MANATEE_BODY } from '@/components/marketing/Logo';

export const runtime = 'edge';
export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

/** iOS home-screen icon: the favicon's manatee mark at apple-touch size. */
export default async function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          background: '#0D3532',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <svg width="140" height="140" viewBox="0 0 40 40">
          <g transform="rotate(38 20 20)" fill="#7CCBBB">
            <path d={MANATEE_BODY} />
            <ellipse cx="28.3" cy="15.6" rx="1.5" ry="3.2" transform="rotate(-48 28.3 15.6)" />
            <ellipse cx="11.7" cy="15.6" rx="1.5" ry="3.2" transform="rotate(48 11.7 15.6)" />
          </g>
        </svg>
      </div>
    ),
    { ...size },
  );
}

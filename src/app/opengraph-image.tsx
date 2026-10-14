import { ImageResponse } from 'next/og';
import { MANATEE_BODY } from '@/components/marketing/Logo';

export const runtime = 'edge';
export const alt = 'Crystal River Manatee Fun — Swim with wild manatees';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/**
 * Default Open Graph card for the site: the brand mark, the headline, and
 * the facts people decide on. No photo dependency, so it renders the same
 * on first deploy as it does once photos are uploaded. Next.js wires this
 * to <meta property="og:image"> automatically.
 */
/** Archivo, expanded and heavy like the site's headlines. Optional: if
 *  Google Fonts can't be reached the card renders in the default face. */
async function loadArchivo(): Promise<ArrayBuffer | null> {
  try {
    // No browser User-Agent, so Google serves a TTF, which Satori can read.
    const css = await fetch('https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@118,800').then((r) =>
      r.ok ? r.text() : '',
    );
    const url = css.match(/src: url\((.+?)\) format/)?.[1];
    if (!url) return null;
    const res = await fetch(url);
    return res.ok ? await res.arrayBuffer() : null;
  } catch {
    return null;
  }
}

export default async function OpenGraphImage() {
  const archivo = await loadArchivo();
  const display = archivo ? 'Archivo' : undefined;
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '72px 88px',
          background: 'linear-gradient(150deg, #0D3532 0%, #0E201E 100%)',
          color: '#FFFFFF',
          fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
          position: 'relative',
        }}
      >
        <svg
          width="560"
          height="560"
          viewBox="0 0 40 40"
          style={{ position: 'absolute', right: -60, bottom: -90, opacity: 0.16 }}
        >
          <g transform="rotate(38 20 20)" fill="#7CCBBB">
            <path d={MANATEE_BODY} />
            <ellipse cx="28.3" cy="15.6" rx="1.5" ry="3.2" transform="rotate(-48 28.3 15.6)" />
            <ellipse cx="11.7" cy="15.6" rx="1.5" ry="3.2" transform="rotate(48 11.7 15.6)" />
          </g>
        </svg>

        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <div
            style={{
              width: 72,
              height: 72,
              borderRadius: 36,
              background: '#0E201E',
              border: '2px solid rgba(124,203,187,0.4)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <svg width="52" height="52" viewBox="0 0 40 40">
              <g transform="rotate(38 20 20)" fill="#7CCBBB">
                <path d={MANATEE_BODY} />
                <ellipse cx="28.3" cy="15.6" rx="1.5" ry="3.2" transform="rotate(-48 28.3 15.6)" />
                <ellipse cx="11.7" cy="15.6" rx="1.5" ry="3.2" transform="rotate(48 11.7 15.6)" />
              </g>
            </svg>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: 20, letterSpacing: 4, textTransform: 'uppercase', color: '#7CCBBB' }}>
              Crystal River
            </span>
            <span style={{ fontSize: 34, fontFamily: display, fontWeight: 800, letterSpacing: -0.5 }}>Manatee Fun</span>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: archivo ? 104 : 112, fontFamily: display, fontWeight: 800, lineHeight: 1, letterSpacing: -3 }}>
            Swim with wild manatees.
          </div>
          <div style={{ marginTop: 36, display: 'flex', gap: 16, fontSize: 28, color: 'rgba(255,255,255,0.8)' }}>
            <span>Two-hour tours from $84</span>
            <span style={{ color: '#F26A21' }}>·</span>
            <span>Six guests at most</span>
            <span style={{ color: '#F26A21' }}>·</span>
            <span>Capt. Travis Urbin</span>
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: archivo ? [{ name: 'Archivo', data: archivo, weight: 800, style: 'normal' }] : undefined,
    },
  );
}

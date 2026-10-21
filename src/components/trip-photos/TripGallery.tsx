import Image from 'next/image';
import { showsAsPhoto, type GalleryFile } from '@/lib/trip-photos-server';

/**
 * The departure's photos and videos, each with its own download button.
 * Photos are shown as resized thumbnails (GoPro originals are several MB
 * each) and open full size in a new tab; videos play in place. A file the
 * site can't show as a photo (HEIC, raw GPR or DNG, a very big one) is a
 * tile with its name. A file Storage hands out as an attachment (videos
 * and big files) downloads straight from Storage, not through the website,
 * which can't send one over 32 MiB.
 */
export function TripGallery({
  bookingId,
  query,
  files,
}: {
  bookingId: string;
  /** The gallery link's own `?k=…` or `?t=…`, which the downloads check too. */
  query: string;
  files: GalleryFile[];
}) {
  const download = (f: GalleryFile) => (f.attachment ? f.url : `/my-booking/${bookingId}/photos/file/${f.id}${query}`);

  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {files.map((f) => {
        const video = f.contentType.startsWith('video/');
        return (
          <li key={f.id} className="overflow-hidden rounded-xl border border-[var(--color-sand)] bg-white">
            <div className="relative aspect-square bg-[var(--color-ink)]/5">
              {video ? (
                <video
                  src={f.url}
                  controls
                  playsInline
                  preload="metadata"
                  className="focus-inset h-full w-full object-cover"
                  aria-label={f.name}
                />
              ) : !showsAsPhoto(f) ? (
                <div className="flex h-full flex-col items-center justify-center gap-2 p-3 text-center">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden className="text-[var(--color-ink-soft)]">
                    <path
                      d="M4 5a1 1 0 011-1h14a1 1 0 011 1v14a1 1 0 01-1 1H5a1 1 0 01-1-1V5zm0 11l4.5-4.5 4 4 2.5-2.5L20 18"
                      stroke="currentColor"
                      strokeWidth="1.75"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  <span className="line-clamp-3 break-all text-sm font-semibold">{f.name}</span>
                  <span className="text-xs text-[var(--color-ink-soft)]">No preview here. Download it to see it.</span>
                </div>
              ) : (
                // Fills the tile: the image inside is absolutely placed, so
                // an inline link would be 0×0 and show no focus ring. And
                // Chrome paints that image over the link's own inset ring,
                // so the image goes beneath the link (isolate, -z-10).
                <a
                  href={f.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Open ${f.name} full size`}
                  className="focus-inset absolute inset-0 block isolate"
                >
                  <Image
                    src={f.url}
                    alt=""
                    fill
                    sizes="(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
                    // The local Storage emulator isn't an allowed image host.
                    unoptimized={f.url.startsWith('http://')}
                    className="-z-10 object-cover"
                  />
                </a>
              )}
            </div>
            <a
              href={download(f)}
              className="focus-inset flex min-h-11 items-center justify-center gap-1.5 border-t border-[var(--color-sand)] text-sm font-semibold text-[var(--color-spring-deep)] hover:bg-[var(--color-mist)]/60"
              aria-label={`Download ${f.name}`}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path
                  d="M12 4v11m0 0l-4.5-4.5M12 15l4.5-4.5M5 19h14"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              {video ? 'Download video' : 'Download'}
            </a>
          </li>
        );
      })}
    </ul>
  );
}

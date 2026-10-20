import Image from 'next/image';
import type { GalleryFile } from '@/lib/trip-photos-server';

/**
 * The departure's photos and videos, each with its own download button.
 * Photos are shown as resized thumbnails (GoPro originals are several MB
 * each) and open full size in a new tab; videos play in place.
 */
export function TripGallery({
  bookingId,
  accessToken,
  files,
}: {
  bookingId: string;
  accessToken: string;
  files: GalleryFile[];
}) {
  const download = (f: GalleryFile) =>
    `/my-booking/${bookingId}/photos/file/${f.id}?t=${encodeURIComponent(accessToken)}`;

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
                  className="h-full w-full object-cover"
                  aria-label={f.name}
                />
              ) : (
                <a href={f.url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${f.name} full size`}>
                  <Image
                    src={f.url}
                    alt=""
                    fill
                    sizes="(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
                    // The local Storage emulator isn't an allowed image host.
                    unoptimized={f.url.startsWith('http://')}
                    className="object-cover"
                  />
                </a>
              )}
            </div>
            <a
              href={download(f)}
              className="flex min-h-11 items-center justify-center gap-1.5 border-t border-[var(--color-sand)] text-sm font-semibold text-[var(--color-spring-deep)] hover:bg-[var(--color-mist)]/60"
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

'use client';

import Image, { type StaticImageData } from 'next/image';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Close } from '@/components/ui/icons';

export interface GalleryPhoto {
  src: string | StaticImageData;
  alt: string;
  width: number;
  height: number;
}

/**
 * Masonry grid of photos. Tapping one opens it full screen; arrow keys or
 * the on-screen buttons move through the set, Escape closes.
 */
export function GalleryGrid({ photos }: { photos: GalleryPhoto[] }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [index, setIndex] = useState<number | null>(null);

  const open = (i: number) => {
    setIndex(i);
    dialogRef.current?.showModal();
  };
  const close = useCallback(() => dialogRef.current?.close(), []);
  const step = useCallback(
    (delta: number) => setIndex((i) => (i == null ? i : (i + delta + photos.length) % photos.length)),
    [photos.length],
  );

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const onClose = () => setIndex(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') step(1);
      if (e.key === 'ArrowLeft') step(-1);
    };
    dialog.addEventListener('close', onClose);
    dialog.addEventListener('keydown', onKey);
    return () => {
      dialog.removeEventListener('close', onClose);
      dialog.removeEventListener('keydown', onKey);
    };
  }, [step]);

  const current = index == null ? null : photos[index];

  return (
    <>
      <ul className="columns-1 gap-4 sm:columns-2 lg:columns-3 [&>li]:mb-4">
        {photos.map((p, i) => (
          <li key={typeof p.src === 'string' ? p.src : p.src.src} className="break-inside-avoid">
            <button
              type="button"
              onClick={() => open(i)}
              className="group relative block w-full overflow-hidden rounded-xl bg-[var(--color-sand)]"
              style={{ aspectRatio: `${p.width} / ${p.height}` }}
              aria-label={`View larger: ${p.alt}`}
            >
              <Image
                src={p.src}
                alt={p.alt}
                fill
                sizes="(min-width: 1024px) 400px, (min-width: 640px) 50vw, 100vw"
                className="object-cover transition-transform duration-700 ease-out group-hover:scale-[1.03]"
              />
            </button>
          </li>
        ))}
      </ul>

      <dialog
        ref={dialogRef}
        aria-label="Photo viewer"
        onClick={(e) => {
          // Clicks on the backdrop (the dialog itself) close it.
          if (e.target === e.currentTarget) close();
        }}
        className="m-0 h-full max-h-none w-full max-w-none bg-black/92 p-0 text-white backdrop:bg-black/80"
      >
        {current && (
          <div className="flex h-full flex-col" onClick={(e) => e.target === e.currentTarget && close()}>
            <div className="flex items-center justify-between px-4 py-3 sm:px-6">
              <p className="text-sm tabular-nums text-white/60">
                {index! + 1} / {photos.length}
              </p>
              <button
                type="button"
                onClick={close}
                autoFocus
                aria-label="Close"
                className="inline-flex h-11 w-11 items-center justify-center rounded-full hover:bg-white/10"
              >
                <Close size={24} />
              </button>
            </div>
            <div className="relative flex-1" onClick={(e) => e.target === e.currentTarget && close()}>
              <Image
                key={typeof current.src === 'string' ? current.src : current.src.src}
                src={current.src}
                alt={current.alt}
                fill
                sizes="100vw"
                className="object-contain"
              />
            </div>
            <div className="flex items-center justify-between gap-4 px-4 py-4 sm:px-6">
              <button
                type="button"
                onClick={() => step(-1)}
                aria-label="Previous photo"
                className="inline-flex h-12 w-12 items-center justify-center rounded-full border border-white/20 hover:bg-white/10"
              >
                <ChevronLeft size={24} />
              </button>
              <p className="line-clamp-2 max-w-xl text-center text-sm text-white/75">{current.alt}</p>
              <button
                type="button"
                onClick={() => step(1)}
                aria-label="Next photo"
                className="inline-flex h-12 w-12 items-center justify-center rounded-full border border-white/20 hover:bg-white/10"
              >
                <ChevronRight size={24} />
              </button>
            </div>
          </div>
        )}
      </dialog>
    </>
  );
}

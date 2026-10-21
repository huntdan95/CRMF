'use client';

import Image from 'next/image';
import { useEffect, useState, type ReactNode } from 'react';
import {
  ref as storageRef,
  uploadBytesResumable,
  getDownloadURL,
} from 'firebase/storage';
import { getBucket } from '@/lib/firebase/client';
import { admin } from '@/lib/admin-client';
import {
  SITE_IMAGE_SLOTS,
  TOUR_SLOTS,
  type SlotConfig,
} from '@/lib/site-images';
import { photos } from '@/lib/photos';
import {
  adminAuthReady,
} from '@/lib/admin-firestore';
import { getDb } from '@/lib/firebase/client';
import { doc, getDoc } from 'firebase/firestore';
import type { SiteImage, SiteImageSlot } from '@/lib/firebase/types';
import { clsx } from '@/lib/clsx';
import { Badge, SectionHeading, buttonClass, inputClass, labelClass, panelClass } from './ui';

/**
 * The older upload the website falls back to while a spot is empty (the
 * `fallbackSlot` the marketing pages give <SiteImage>), before it uses the
 * built-in photo.
 */
const OLDER_FALLBACK: Partial<Record<SiteImageSlot, SiteImageSlot>> = {
  'manners-callout': 'pair',
  'about-captain': 'greeting',
  'about-area': 'group',
  ...Object.fromEntries(TOUR_SLOTS.map((s) => [s, 'dappled' as const])),
};

const SAVED = 'Saved. The website shows it now, or within a minute at most.';

interface SlotState {
  current: SiteImage | null;
  loading: boolean;
  /** Couldn't read what's uploaded, so don't claim the spot is empty. */
  loadFailed: boolean;
  draftAlt: string;
  busy: 'upload' | 'save' | 'remove' | null;
  progress: number;
  error: string | null;
  flash: string | null;
}

function initialState(): SlotState {
  return {
    current: null,
    loading: true,
    loadFailed: false,
    draftAlt: '',
    busy: null,
    progress: 0,
    error: null,
    flash: null,
  };
}

/** Longest side, in pixels, of a photo as stored. Plenty for a full-width hero on a big screen. */
const MAX_PHOTO_SIDE = 2400;

/**
 * Phone photos are 4000+ pixels wide and several MB. The site resizes them for
 * each screen, but resizing a full-size original is slow on a server that has
 * just woken up, so pages wait on it. Shrink big photos in the browser first.
 * Returns null to upload the original unchanged: already small enough, or the
 * browser can't decode it.
 */
async function shrinkPhoto(
  file: File,
): Promise<{ blob: Blob; width: number; height: number } | null> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const { width, height } = bitmap;
    const scale = Math.min(1, MAX_PHOTO_SIDE / Math.max(width, height));
    if (scale === 1 && file.size <= 1_500_000) {
      bitmap.close();
      return null;
    }
    const w = Math.round(width * scale);
    const h = Math.round(height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      bitmap.close();
      return null;
    }
    // JPEG has no transparency: give see-through PNGs a white background, not black.
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    return blob ? { blob, width: w, height: h } : null;
  } catch {
    return null;
  }
}

export function PhotosAdmin() {
  const [state, setState] = useState<Record<string, SlotState>>(() =>
    Object.fromEntries(
      SITE_IMAGE_SLOTS.map((s) => [s.slot, initialState()]),
    ),
  );

  function updateSlot(slot: string, patch: Partial<SlotState>) {
    setState((prev) => ({
      ...prev,
      [slot]: { ...prev[slot]!, ...patch },
    }));
  }

  useEffect(() => {
    (async () => {
      try {
        await adminAuthReady();
      } catch {
        setState((prev) =>
          Object.fromEntries(
            Object.entries(prev).map(([k, v]) => [k, { ...v, loading: false, loadFailed: true }]),
          ),
        );
        return;
      }
      await Promise.all(
        SITE_IMAGE_SLOTS.map(async (cfg) => {
          try {
            const snap = await getDoc(doc(getDb(), 'siteImages', cfg.slot));
            if (snap.exists()) {
              const data = snap.data() as SiteImage;
              updateSlot(cfg.slot, {
                current: data,
                draftAlt: data.alt,
                loading: false,
              });
            } else {
              updateSlot(cfg.slot, { loading: false });
            }
          } catch {
            updateSlot(cfg.slot, { loading: false, loadFailed: true });
          }
        }),
      );
    })();
  }, []);

  async function readImageDimensions(file: File): Promise<{ width: number; height: number } | null> {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const img = new globalThis.Image();
      img.onload = () => {
        resolve({ width: img.naturalWidth, height: img.naturalHeight });
        URL.revokeObjectURL(url);
      };
      img.onerror = () => {
        resolve(null);
        URL.revokeObjectURL(url);
      };
      img.src = url;
    });
  }

  async function upload(cfg: SlotConfig, original: File) {
    updateSlot(cfg.slot, {
      busy: 'upload',
      progress: 0,
      error: null,
      flash: null,
    });
    try {
      const shrunk = await shrinkPhoto(original);
      const file = shrunk?.blob ?? original;
      const ext = shrunk ? 'jpg' : original.name.split('.').pop()?.toLowerCase() || 'jpg';
      const path = `public/site-images/${cfg.slot}_${Date.now()}.${ext}`;
      const ref = storageRef(getBucket(), path);
      const task = uploadBytesResumable(ref, file, {
        contentType: shrunk ? 'image/jpeg' : original.type || 'image/jpeg',
        cacheControl: 'public,max-age=31536000,immutable',
      });

      const dims = shrunk ? { width: shrunk.width, height: shrunk.height } : await readImageDimensions(original);

      await new Promise<void>((resolve, reject) => {
        task.on(
          'state_changed',
          (snap) => {
            const pct = (snap.bytesTransferred / snap.totalBytes) * 100;
            updateSlot(cfg.slot, { progress: pct });
          },
          (err) => reject(err),
          () => resolve(),
        );
      });

      const downloadUrl = await getDownloadURL(task.snapshot.ref);

      const draftAlt = state[cfg.slot]!.draftAlt.trim() || cfg.defaultAlt;

      await admin.updateSiteImage({
        slot: cfg.slot,
        storagePath: path,
        downloadUrl,
        alt: draftAlt,
        width: dims?.width ?? null,
        height: dims?.height ?? null,
      });

      updateSlot(cfg.slot, {
        busy: null,
        progress: 100,
        flash: SAVED,
        current: {
          slot: cfg.slot,
          storagePath: path,
          downloadUrl,
          alt: draftAlt,
          width: dims?.width ?? null,
          height: dims?.height ?? null,
          // Timestamp will be set by the server; this is just a local approximation.
          updatedAt: undefined as never,
          updatedBy: 'just now',
        },
        draftAlt,
      });
    } catch (err) {
      console.error('Photo upload failed', err);
      updateSlot(cfg.slot, {
        busy: null,
        error: 'The photo didn’t upload. Check your connection and try again.',
      });
    }
  }

  async function saveAlt(cfg: SlotConfig) {
    const slotState = state[cfg.slot]!;
    if (!slotState.current) return;
    const alt = slotState.draftAlt.trim() || cfg.defaultAlt;
    updateSlot(cfg.slot, { busy: 'save', error: null, flash: null });
    try {
      await admin.updateSiteImage({
        slot: cfg.slot,
        storagePath: slotState.current.storagePath,
        downloadUrl: slotState.current.downloadUrl,
        alt,
        width: slotState.current.width,
        height: slotState.current.height,
      });
      updateSlot(cfg.slot, {
        busy: null,
        flash: SAVED,
        current: { ...slotState.current, alt },
        draftAlt: alt,
      });
    } catch (err) {
      console.error('Photo description save failed', err);
      updateSlot(cfg.slot, {
        busy: null,
        error: 'Couldn’t save. Check your connection and try again.',
      });
    }
  }

  async function clearPhoto(cfg: SlotConfig) {
    const older = OLDER_FALLBACK[cfg.slot];
    const instead =
      cfg.group === 'legacy'
        ? 'Spots above that are still empty will show the built-in photo instead.'
        : older && state[older]?.current
          ? 'Your older photo will show there instead.'
          : 'The built-in photo will show there instead.';
    if (!confirm(`Take this photo off the website? ${instead}`)) return;
    updateSlot(cfg.slot, { busy: 'remove', error: null, flash: null });
    try {
      await admin.deleteSiteImage(cfg.slot);
      updateSlot(cfg.slot, {
        busy: null,
        current: null,
        draftAlt: '',
        flash: 'Removed. The website changes over now, or within a minute at most.',
      });
    } catch (err) {
      console.error('Photo removal failed', err);
      updateSlot(cfg.slot, {
        busy: null,
        error: 'Couldn’t remove the photo. Check your connection and try again.',
      });
    }
  }

  // Split slots into rendering groups.
  const sectionSlots = SITE_IMAGE_SLOTS.filter((s) => s.group === 'sections');
  const tourSlots = SITE_IMAGE_SLOTS.filter((s) => s.group === 'tours');
  // Older photos only matter while they're still uploaded (or just removed,
  // so the "Removed" note stays put).
  const legacySlots = SITE_IMAGE_SLOTS.filter(
    (s) => s.group === 'legacy' && (state[s.slot]?.current || state[s.slot]?.flash),
  );
  const anyLoadFailed = Object.values(state).some((s) => s.loadFailed);

  const groupProps = { state, updateSlot, upload, saveAlt, clearPhoto };

  return (
    <div className="space-y-10">
      {anyLoadFailed && (
        <div className="rounded-2xl bg-[var(--color-coral)]/10 border border-[var(--color-coral)]/30 p-4 text-sm">
          <p>
            Couldn’t check some of the photos just now. Nothing has changed on
            your website. Check your connection, then reload the page.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className={clsx(buttonClass('primary'), 'mt-3')}
          >
            Reload the page
          </button>
        </div>
      )}

      <div className="rounded-2xl border border-[var(--color-spring)]/20 bg-[var(--color-mist)] p-5 text-sm">
        <p>
          Each photo below is one spot on the website. Tap “Upload a photo”
          to pick one from your phone. The website shows it within about a
          minute.
        </p>
        <p className="mt-2 text-[var(--color-ink-soft)]">
          Any sharp photo works, wide or tall. The website trims the edges to
          fit each spot, so keep the main thing near the middle.
        </p>
      </div>

      <PhotoGroup
        title="Home and About pages"
        description="The big photos on the home page and the About page."
        slots={sectionSlots}
        {...groupProps}
      />

      <PhotoGroup
        title="Tours"
        description="One photo for each tour. It shows on the tour’s card and at the top of its page."
        slots={tourSlots}
        {...groupProps}
      />

      {legacySlots.length > 0 && (
        <PhotoGroup
          title="Older photos"
          description="Uploaded before the website was reorganized. The website still uses them in spots above that are empty. Once those spots have their own photos, you can remove these."
          slots={legacySlots}
          {...groupProps}
        />
      )}
    </div>
  );
}

interface GroupProps {
  title: string;
  description: string;
  slots: SlotConfig[];
  state: Record<string, SlotState>;
  updateSlot: (slot: string, patch: Partial<SlotState>) => void;
  upload: (cfg: SlotConfig, file: File) => void;
  saveAlt: (cfg: SlotConfig) => void;
  clearPhoto: (cfg: SlotConfig) => void;
}

function PhotoGroup({
  title,
  description,
  slots,
  state,
  updateSlot,
  upload,
  saveAlt,
  clearPhoto,
}: GroupProps) {
  return (
    <section>
      <SectionHeading
        title={title}
        description={description}
        aside={<Badge>{slots.length} {slots.length === 1 ? 'spot' : 'spots'}</Badge>}
      />
      <div className="space-y-4">
        {slots.map((cfg) => {
          const s = state[cfg.slot]!;
          const olderSlot = OLDER_FALLBACK[cfg.slot];
          const older = olderSlot ? state[olderSlot] : undefined;
          const olderCfg = olderSlot ? SITE_IMAGE_SLOTS.find((c) => c.slot === olderSlot) : undefined;
          const legacy = cfg.group === 'legacy';
          const busy = s.busy !== null;
          const altChanged = !!s.current && s.draftAlt.trim() !== s.current.alt;

          // What the website shows in this spot right now.
          let preview: ReactNode;
          let caption: string | null = null;
          // What's in the spot now, at a glance.
          let status: ReactNode = null;
          if (s.loading || (!s.current && older?.loading)) {
            preview = <PreviewText>Loading…</PreviewText>;
          } else if (s.loadFailed || (!s.current && older?.loadFailed)) {
            preview = <PreviewText>Couldn’t check this photo. Reload the page.</PreviewText>;
          } else if (s.current) {
            status = <Badge tone="spring">Your photo</Badge>;
            preview = (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={s.current.downloadUrl}
                alt={s.current.alt}
                className="absolute inset-0 w-full h-full object-cover"
              />
            );
          } else if (legacy) {
            preview = <PreviewText>Removed from the website.</PreviewText>;
          } else if (older?.current) {
            status = <Badge tone="sand">Older photo</Badge>;
            preview = (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={older.current.downloadUrl}
                alt={older.current.alt}
                className="absolute inset-0 w-full h-full object-cover"
              />
            );
            caption = `Your older photo${olderCfg ? ` (“${olderCfg.label}”)` : ''} shows here for now. Upload your own to replace it.`;
          } else {
            const local = photos[cfg.fallbackPhoto];
            status = <Badge>Built-in photo</Badge>;
            preview = (
              <Image
                src={local.src}
                alt={local.alt}
                fill
                sizes="(min-width: 640px) 200px, 100vw"
                placeholder="blur"
                className="object-cover"
              />
            );
            caption = 'Built-in photo. Upload your own to replace it.';
          }
          const canEdit = !s.loading && !s.loadFailed;

          return (
            <article key={cfg.slot} className={clsx(panelClass, 'overflow-hidden')}>
              <div className="grid sm:grid-cols-[232px_1fr]">
                <div className="p-4 bg-[var(--color-paper)]/70 border-b sm:border-b-0 sm:border-r border-[var(--color-line)]">
                  <div className="relative aspect-[4/3] rounded-lg overflow-hidden bg-[var(--color-sand)] shadow-[0_0_0_1px_rgba(14,32,30,0.08)]">
                    {preview}
                  </div>
                  {caption && (
                    <p className="mt-2.5 text-xs leading-relaxed text-[var(--color-ink-soft)]">{caption}</p>
                  )}
                </div>

                <div className="p-5">
                  <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                    <h3 className="font-display text-lg leading-tight">{cfg.label}</h3>
                    {status}
                  </div>
                  <p className="mt-1.5 text-sm text-[var(--color-ink-soft)]">
                    {cfg.description}
                  </p>

                  {canEdit && !legacy && (
                    <label className="block mt-5">
                      <span className={labelClass}>
                        Photo description{' '}
                        <span className="font-normal text-[var(--color-ink-soft)]">
                          (helps Google and blind visitors)
                        </span>
                      </span>
                      <input
                        type="text"
                        value={s.draftAlt}
                        onChange={(e) =>
                          updateSlot(cfg.slot, { draftAlt: e.target.value })
                        }
                        placeholder={cfg.defaultAlt}
                        maxLength={200}
                        className={inputClass}
                      />
                    </label>
                  )}

                  {canEdit && (
                    <div className="mt-4 flex flex-wrap gap-2 items-center">
                      {!legacy && (
                        <label
                          className={clsx(
                            buttonClass('primary'),
                            'focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--color-spring)]',
                            busy ? 'opacity-60 cursor-wait' : 'cursor-pointer',
                          )}
                        >
                          {s.busy === 'upload'
                            ? `Uploading… ${s.progress.toFixed(0)}%`
                            : s.current
                              ? 'Upload a different photo'
                              : 'Upload a photo'}
                          <input
                            type="file"
                            accept="image/jpeg,image/png,image/webp"
                            disabled={busy}
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) upload(cfg, file);
                              e.target.value = '';
                            }}
                            className="sr-only"
                          />
                        </label>
                      )}

                      {s.current && altChanged && !legacy && (
                        <button
                          type="button"
                          onClick={() => saveAlt(cfg)}
                          disabled={busy}
                          className={buttonClass('secondary')}
                        >
                          {s.busy === 'save' ? 'Saving…' : 'Save description'}
                        </button>
                      )}

                      {s.current && (
                        <button
                          type="button"
                          onClick={() => clearPhoto(cfg)}
                          disabled={busy}
                          className={buttonClass('danger')}
                        >
                          {s.busy === 'remove' ? 'Removing…' : 'Remove photo'}
                        </button>
                      )}
                    </div>
                  )}

                  {s.flash && (
                    <p className="mt-3 text-sm font-medium text-[var(--color-spring)]" role="status">
                      {s.flash}
                    </p>
                  )}
                  {s.error && (
                    <p className="mt-3 text-sm font-medium text-[var(--color-coral-dark)]" role="alert">
                      {s.error}
                    </p>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function PreviewText({ children }: { children: ReactNode }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center text-sm text-[var(--color-ink-soft)] text-center px-3">
      {children}
    </div>
  );
}

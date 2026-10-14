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

const SAVED = 'Saved. The website shows it within about a minute.';

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

  async function upload(cfg: SlotConfig, file: File) {
    updateSlot(cfg.slot, {
      busy: 'upload',
      progress: 0,
      error: null,
      flash: null,
    });
    try {
      const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
      const path = `public/site-images/${cfg.slot}_${Date.now()}.${ext}`;
      const ref = storageRef(getBucket(), path);
      const task = uploadBytesResumable(ref, file, {
        contentType: file.type || 'image/jpeg',
        cacheControl: 'public,max-age=31536000,immutable',
      });

      const dims = await readImageDimensions(file);

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
        flash: 'Removed. The website changes over within about a minute.',
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
            className="mt-3 inline-flex items-center justify-center min-h-11 px-4 rounded-xl bg-[var(--color-brand-blue)] hover:bg-[var(--color-brand-blue-dark)] text-white text-sm font-medium"
          >
            Reload the page
          </button>
        </div>
      )}

      <div className="rounded-2xl bg-[var(--color-cream)] border border-[var(--color-ink)]/8 p-5 text-sm">
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
      <header className="mb-4">
        <h2 className="font-display text-2xl">{title}</h2>
        <p className="mt-1 text-sm text-[var(--color-ink-soft)] max-w-2xl">
          {description}
        </p>
      </header>
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
          if (s.loading || (!s.current && older?.loading)) {
            preview = <PreviewText>Loading…</PreviewText>;
          } else if (s.loadFailed || (!s.current && older?.loadFailed)) {
            preview = <PreviewText>Couldn’t check this photo. Reload the page.</PreviewText>;
          } else if (s.current) {
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
            preview = (
              <Image
                src={local.src}
                alt={local.alt}
                fill
                sizes="(min-width: 640px) 180px, 100vw"
                placeholder="blur"
                className="object-cover"
              />
            );
            caption = 'Built-in photo. Upload your own to replace it.';
          }
          const canEdit = !s.loading && !s.loadFailed;

          return (
            <article
              key={cfg.slot}
              className="bg-white rounded-2xl border border-[var(--color-ink)]/8 shadow-[var(--shadow-card)] p-5"
            >
              <div className="grid sm:grid-cols-[180px_1fr] gap-5">
                <div>
                  <div className="relative aspect-[4/3] rounded-xl overflow-hidden bg-[var(--color-cream)] border border-[var(--color-ink)]/8">
                    {preview}
                  </div>
                  {caption && (
                    <p className="mt-2 text-sm text-[var(--color-ink-soft)]">{caption}</p>
                  )}
                </div>

                <div>
                  <h3 className="font-display text-lg">{cfg.label}</h3>
                  <p className="mt-1 text-sm text-[var(--color-ink-soft)]">
                    {cfg.description}
                  </p>

                  {canEdit && !legacy && (
                    <label className="block mt-4">
                      <span className="block text-sm font-medium mb-1">
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
                        className="w-full min-h-11 rounded-xl border border-[var(--color-ink)]/15 bg-white px-3 py-2 text-base focus:border-[var(--color-brand-blue)] focus:outline-2 focus:outline-[var(--color-brand-blue)]/20"
                      />
                    </label>
                  )}

                  {canEdit && (
                    <div className="mt-3 flex flex-wrap gap-2 items-center">
                      {!legacy && (
                        <label
                          className={clsx(
                            'inline-flex items-center justify-center min-h-11 px-4 rounded-xl text-sm font-medium focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--color-brand-blue)]',
                            busy
                              ? 'bg-[var(--color-ink)]/10 text-[var(--color-ink-soft)] cursor-wait'
                              : 'bg-[var(--color-brand-blue)] hover:bg-[var(--color-brand-blue-dark)] text-white cursor-pointer',
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
                          className="inline-flex items-center justify-center min-h-11 px-4 rounded-xl text-sm font-medium border border-[var(--color-ink)]/15 hover:bg-[var(--color-ink)]/5 disabled:opacity-60"
                        >
                          {s.busy === 'save' ? 'Saving…' : 'Save description'}
                        </button>
                      )}

                      {s.current && (
                        <button
                          type="button"
                          onClick={() => clearPhoto(cfg)}
                          disabled={busy}
                          className="inline-flex items-center justify-center min-h-11 px-4 rounded-xl text-sm font-medium text-[var(--color-coral-dark)] hover:bg-[var(--color-coral)]/10 disabled:opacity-60"
                        >
                          {s.busy === 'remove' ? 'Removing…' : 'Remove photo'}
                        </button>
                      )}
                    </div>
                  )}

                  {s.flash && (
                    <p className="mt-2 text-sm text-[var(--color-brand-blue)]" role="status">
                      {s.flash}
                    </p>
                  )}
                  {s.error && (
                    <p className="mt-2 text-sm text-[var(--color-coral-dark)]" role="alert">
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

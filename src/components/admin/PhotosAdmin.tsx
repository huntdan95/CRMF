'use client';

import { useEffect, useState } from 'react';
import {
  ref as storageRef,
  uploadBytesResumable,
  getDownloadURL,
} from 'firebase/storage';
import { getBucket } from '@/lib/firebase/client';
import { admin } from '@/lib/admin-client';
import { FunctionError } from '@/lib/functions-client';
import {
  SITE_IMAGE_SLOTS,
  type SlotConfig,
} from '@/lib/site-images';
import {
  adminAuthReady,
} from '@/lib/admin-firestore';
import { getDb } from '@/lib/firebase/client';
import { doc, getDoc } from 'firebase/firestore';
import type { SiteImage } from '@/lib/firebase/types';
import { clsx } from '@/lib/clsx';

interface SlotState {
  current: SiteImage | null;
  loading: boolean;
  draftAlt: string;
  uploading: boolean;
  progress: number;
  error: string | null;
  flash: string | null;
}

function initialState(): SlotState {
  return {
    current: null,
    loading: true,
    draftAlt: '',
    uploading: false,
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
              updateSlot(cfg.slot, { loading: false });
            }
          }),
        );
      } catch {
        // Set all to non-loading even on auth failure so the UI doesn't hang.
        setState((prev) =>
          Object.fromEntries(
            Object.entries(prev).map(([k, v]) => [k, { ...v, loading: false }]),
          ),
        );
      }
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
      uploading: true,
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
        uploading: false,
        progress: 100,
        flash: 'Uploaded. Refresh the public pages to see it live.',
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
      updateSlot(cfg.slot, {
        uploading: false,
        error:
          err instanceof FunctionError
            ? err.message
            : err instanceof Error
              ? err.message
              : 'Upload failed.',
      });
    }
  }

  async function saveAlt(cfg: SlotConfig) {
    const slotState = state[cfg.slot]!;
    if (!slotState.current) return;
    updateSlot(cfg.slot, { uploading: true, error: null, flash: null });
    try {
      await admin.updateSiteImage({
        slot: cfg.slot,
        storagePath: slotState.current.storagePath,
        downloadUrl: slotState.current.downloadUrl,
        alt: slotState.draftAlt.trim() || cfg.defaultAlt,
        width: slotState.current.width,
        height: slotState.current.height,
      });
      updateSlot(cfg.slot, { uploading: false, flash: 'Alt text saved.' });
    } catch (err) {
      updateSlot(cfg.slot, {
        uploading: false,
        error:
          err instanceof FunctionError
            ? err.message
            : err instanceof Error
              ? err.message
              : 'Save failed.',
      });
    }
  }

  async function clearPhoto(cfg: SlotConfig) {
    if (!confirm(`Remove the ${cfg.label} photo? The slot will fall back to the placeholder.`))
      return;
    updateSlot(cfg.slot, { uploading: true, error: null, flash: null });
    try {
      await admin.deleteSiteImage(cfg.slot);
      updateSlot(cfg.slot, {
        uploading: false,
        current: null,
        draftAlt: '',
        flash: 'Removed.',
      });
    } catch (err) {
      updateSlot(cfg.slot, {
        uploading: false,
        error: err instanceof Error ? err.message : 'Remove failed.',
      });
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl bg-[var(--color-cream)] border border-[var(--color-ink)]/8 p-5 text-sm">
        <p>
          Each photo below maps to one or more places across the public site.
          Uploads go to Firebase Storage; the marketing pages read the new
          photo on the next request (no rebuild needed).
        </p>
        <p className="mt-2 text-[var(--color-ink-soft)]">
          Recommended: 1600×1200 or larger JPEG (under 4 MB). The site
          renders responsively, so even portrait shots work.
        </p>
      </div>

      {SITE_IMAGE_SLOTS.map((cfg) => {
        const s = state[cfg.slot]!;
        return (
          <section
            key={cfg.slot}
            className="bg-white rounded-2xl border border-[var(--color-ink)]/8 shadow-[var(--shadow-card)] p-5"
          >
            <div className="grid sm:grid-cols-[200px_1fr] gap-5">
              {/* Preview */}
              <div className="relative aspect-[4/3] rounded-xl overflow-hidden bg-[var(--color-cream)] border border-[var(--color-ink)]/8">
                {s.current ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={s.current.downloadUrl}
                    alt={s.current.alt}
                    className="absolute inset-0 w-full h-full object-cover"
                  />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center text-xs text-[var(--color-ink-soft)] text-center px-3">
                    {s.loading ? 'Loading…' : 'No upload yet — placeholder showing on the site.'}
                  </div>
                )}
              </div>

              {/* Controls */}
              <div>
                <h2 className="font-display text-lg">{cfg.label}</h2>
                <p className="mt-1 text-sm text-[var(--color-ink-soft)]">
                  {cfg.description}
                </p>

                <label className="block mt-4">
                  <span className="block text-xs uppercase tracking-widest text-[var(--color-ink-soft)] mb-1">
                    Alt text
                  </span>
                  <input
                    type="text"
                    value={s.draftAlt}
                    onChange={(e) =>
                      updateSlot(cfg.slot, { draftAlt: e.target.value })
                    }
                    placeholder={cfg.defaultAlt}
                    className="w-full rounded-xl border border-[var(--color-ink)]/15 bg-white px-3 py-2 text-sm focus:border-[var(--color-brand-blue)] focus:outline-2 focus:outline-[var(--color-brand-blue)]/20"
                  />
                </label>

                <div className="mt-4 flex flex-wrap gap-2 items-center">
                  <label
                    className={clsx(
                      'inline-flex items-center px-4 py-2 rounded-full text-sm font-medium cursor-pointer',
                      s.uploading
                        ? 'bg-[var(--color-ink)]/10 text-[var(--color-ink-soft)] cursor-wait'
                        : 'bg-[var(--color-brand-blue)] hover:bg-[var(--color-brand-blue-dark)] text-white',
                    )}
                  >
                    {s.uploading
                      ? `Uploading ${s.progress.toFixed(0)}%…`
                      : s.current
                        ? 'Replace photo'
                        : 'Upload photo'}
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      disabled={s.uploading}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) upload(cfg, file);
                        e.target.value = '';
                      }}
                      className="sr-only"
                    />
                  </label>

                  {s.current && !s.uploading && (
                    <>
                      <button
                        type="button"
                        onClick={() => saveAlt(cfg)}
                        className="inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium border border-[var(--color-ink)]/15 hover:bg-[var(--color-ink)]/5"
                      >
                        Save alt text
                      </button>
                      <button
                        type="button"
                        onClick={() => clearPhoto(cfg)}
                        className="inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium text-[var(--color-coral-dark)] hover:bg-[var(--color-coral)]/10"
                      >
                        Remove
                      </button>
                    </>
                  )}
                </div>

                {s.flash && (
                  <p className="mt-3 text-xs text-[var(--color-brand-blue)]">
                    {s.flash}
                  </p>
                )}
                {s.error && (
                  <p className="mt-3 text-xs text-[var(--color-coral-dark)]">
                    {s.error}
                  </p>
                )}
                {s.current && s.current.width && s.current.height && (
                  <p className="mt-2 text-xs text-[var(--color-ink-soft)]">
                    {s.current.width} × {s.current.height}
                  </p>
                )}
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
}

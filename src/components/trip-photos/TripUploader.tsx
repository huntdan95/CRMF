'use client';

import { useRef, useState } from 'react';
import { ref, uploadBytesResumable } from 'firebase/storage';
import { getBucket } from '@/lib/firebase/client';
import { clsx } from '@/lib/clsx';

/** Files the phone hands over without a type (some GoPro/HEIC exports). */
const TYPE_BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  heic: 'image/heic',
  heif: 'image/heif',
  gpr: 'image/x-gopro-gpr',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  m4v: 'video/x-m4v',
};

const PARALLEL_UPLOADS = 3;

function mimeTypeOf(file: File): string | null {
  if (/^(image|video)\//.test(file.type)) return file.type;
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  return TYPE_BY_EXTENSION[ext] ?? null;
}

/** Storage object names can't usefully contain path separators. */
function safeName(name: string): string {
  return name.replace(/[\\/#?[\]*]/g, '-').slice(-120) || 'photo';
}

interface Item {
  key: string;
  file: File;
  type: string;
  loaded: number;
  state: 'waiting' | 'uploading' | 'done' | 'failed';
}

function size(bytes: number): string {
  return bytes >= 1024 ** 3
    ? `${(bytes / 1024 ** 3).toFixed(1)} GB`
    : `${Math.max(0.1, bytes / 1024 ** 2).toFixed(1)} MB`;
}

/**
 * Pick photos and videos from the camera roll and upload them straight to
 * Firebase Storage under trips/<tripId>/. No login: the upload token in
 * each file's metadata is what storage.rules checks.
 */
export function TripUploader({
  tripId,
  uploadToken,
  initialCount,
}: {
  tripId: string;
  uploadToken: string;
  initialCount: number;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [uploadedHere, setUploadedHere] = useState(0);
  const [skipped, setSkipped] = useState(0);
  const running = items.some((i) => i.state === 'waiting' || i.state === 'uploading');

  function patch(key: string, change: Partial<Item>) {
    setItems((list) => list.map((i) => (i.key === key ? { ...i, ...change } : i)));
  }

  function uploadOne(item: Item): Promise<void> {
    return new Promise((resolve) => {
      patch(item.key, { state: 'uploading', loaded: 0 });
      const path = `trips/${tripId}/${crypto.randomUUID()}-${safeName(item.file.name)}`;
      const task = uploadBytesResumable(ref(getBucket(), path), item.file, {
        contentType: item.type,
        customMetadata: { uploadToken },
      });
      task.on(
        'state_changed',
        (snap) => patch(item.key, { loaded: snap.bytesTransferred }),
        (err) => {
          console.error('Upload failed', err);
          patch(item.key, { state: 'failed' });
          resolve();
        },
        () => {
          patch(item.key, { state: 'done', loaded: item.file.size });
          setUploadedHere((n) => n + 1);
          resolve();
        },
      );
    });
  }

  async function run(queue: Item[]) {
    // Keep the screen on, and warn before leaving, while uploads run.
    const wakeLock = await navigator.wakeLock?.request('screen').catch(() => null);
    const warnOnLeave = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warnOnLeave);
    let next = 0;
    async function worker() {
      while (next < queue.length) {
        const item = queue[next++]!;
        await uploadOne(item);
      }
    }
    await Promise.all(Array.from({ length: Math.min(PARALLEL_UPLOADS, queue.length) }, worker));
    window.removeEventListener('beforeunload', warnOnLeave);
    await wakeLock?.release().catch(() => undefined);
  }

  function pick(files: FileList | null) {
    if (!files || files.length === 0) return;
    const added: Item[] = [];
    let notMedia = 0;
    for (const file of [...files]) {
      const type = mimeTypeOf(file);
      if (!type) {
        notMedia++;
        continue;
      }
      added.push({ key: crypto.randomUUID(), file, type, loaded: 0, state: 'waiting' });
    }
    setSkipped(notMedia);
    setItems((list) => [...list, ...added]);
    if (inputRef.current) inputRef.current.value = '';
    if (added.length) void run(added);
  }

  function retryFailed() {
    const again = items
      .filter((i) => i.state === 'failed')
      .map((i) => ({ ...i, state: 'waiting' as const, loaded: 0 }));
    setItems((list) => list.map((i) => again.find((f) => f.key === i.key) ?? i));
    if (again.length) void run(again);
  }

  const total = items.reduce((s, i) => s + i.file.size, 0);
  const loaded = items.reduce((s, i) => s + (i.state === 'done' ? i.file.size : i.loaded), 0);
  const done = items.filter((i) => i.state === 'done').length;
  const failed = items.filter((i) => i.state === 'failed').length;
  const count = initialCount + uploadedHere;

  return (
    <div className="space-y-5">
      <p className="text-sm text-[var(--color-ink-soft)]">
        {count === 0
          ? 'Nothing uploaded for this trip yet.'
          : `${count} ${count === 1 ? 'photo or video' : 'photos and videos'} uploaded for this trip so far.`}
      </p>

      <label className="flex min-h-16 w-full cursor-pointer items-center justify-center rounded-2xl bg-[var(--color-spring-deep)] px-5 py-4 text-lg font-semibold text-white shadow-sm active:opacity-90 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--color-spring)]">
        <input
          ref={inputRef}
          type="file"
          accept="image/*,video/*"
          multiple
          className="sr-only"
          onChange={(e) => pick(e.target.files)}
        />
        {items.length ? 'Add more photos and videos' : 'Choose photos and videos'}
      </label>

      {skipped > 0 && (
        <p role="alert" className="text-sm text-[var(--color-error)]">
          Skipped {skipped} {skipped === 1 ? 'file that isn’t' : 'files that aren’t'} a photo or video.
        </p>
      )}

      {items.length > 0 && (
        <section aria-live="polite" className="space-y-3 rounded-2xl border border-[var(--color-sand)] bg-white p-4">
          <div className="flex items-baseline justify-between gap-3 text-sm font-medium">
            <span>
              {running
                ? `Uploading ${done} of ${items.length}…`
                : failed
                  ? `${done} of ${items.length} uploaded`
                  : `All ${done} uploaded`}
            </span>
            <span className="tabular-nums text-[var(--color-ink-soft)]">
              {size(loaded)} / {size(total)}
            </span>
          </div>
          <div
            role="progressbar"
            aria-label="Upload progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={total ? Math.round((loaded / total) * 100) : 0}
            className="h-3 overflow-hidden rounded-full bg-[var(--color-ink)]/10"
          >
            <div
              className="h-full rounded-full bg-[var(--color-spring)] transition-[width]"
              style={{ width: `${total ? Math.round((loaded / total) * 100) : 0}%` }}
            />
          </div>
          {running && <p className="text-xs text-[var(--color-ink-soft)]">Keep this page open until it finishes.</p>}
          {!running && failed > 0 && (
            <button
              type="button"
              onClick={retryFailed}
              className="min-h-12 w-full rounded-xl border border-[var(--color-error)]/40 font-semibold text-[var(--color-error)]"
            >
              Try the {failed} that didn’t upload again
            </button>
          )}
          {!running && failed === 0 && (
            <p className="text-sm">
              Done, thank you. Guests get an email with their photos the morning after the trip, or about an
              hour after the last upload if that’s later.
            </p>
          )}
          <ul className="max-h-72 space-y-1 overflow-y-auto text-sm">
            {items.map((i) => (
              <li key={i.key} className="flex items-center justify-between gap-3">
                <span className="truncate">{i.file.name}</span>
                <span
                  className={clsx(
                    'shrink-0 tabular-nums',
                    i.state === 'failed' ? 'text-[var(--color-error)]' : 'text-[var(--color-ink-soft)]',
                  )}
                >
                  {i.state === 'done'
                    ? 'Done'
                    : i.state === 'failed'
                      ? 'Failed'
                      : i.state === 'waiting'
                        ? 'Waiting'
                        : `${Math.round((i.loaded / Math.max(1, i.file.size)) * 100)}%`}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

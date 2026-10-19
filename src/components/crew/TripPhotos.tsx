'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { RecentTrip } from '@/lib/trip-photos-server';
import { slotLabels, tours } from '@/lib/tours';
import { clsx } from '@/lib/clsx';
import { dayHeading } from './day-label';

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
};

const SESSION_BATCH = 50; // matches the API's per-request limit
const PARALLEL_UPLOADS = 3;

function mimeTypeOf(file: File): string | null {
  if (/^(image|video)\//.test(file.type)) return file.type;
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  return TYPE_BY_EXTENSION[ext] ?? null;
}

class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

async function photosApi<T>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch('/api/crew/photos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.status === 401) {
    window.location.assign('/crew/login');
    throw new ApiError('Signed out', 401);
  }
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new ApiError(json.error ?? `Request failed (${res.status})`, res.status);
  return json;
}

/** PUTs a file straight to Google Drive at a resumable-upload URL. */
function putFile(url: string, file: File, onProgress: (loaded: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.upload.onprogress = (e) => onProgress(e.loaded);
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`Upload failed (${xhr.status})`));
    xhr.onerror = () => reject(new Error('Network error'));
    xhr.send(file);
  });
}

function tripHeading(trip: RecentTrip): { time: string; tour: string } {
  const tour = tours.find((t) => t.id === trip.tourId);
  return {
    time: tour?.startTimeDisplay ?? '',
    tour: `${slotLabels[trip.timeSlot]} · ${trip.type === 'private' ? 'Private' : 'Shared'}`,
  };
}

/**
 * Recent trips by day, with a photo uploader each. Photos go straight from
 * the phone to the trip's Google Drive folder; "Photos are all in" tells
 * grokbot it can email them to the guests.
 */
export function TripPhotos({
  trips,
  today,
  uploadsEnabled,
}: {
  trips: RecentTrip[];
  today: string;
  uploadsEnabled: boolean;
}) {
  // Trips come newest first, so the days do too.
  const days = new Map<string, RecentTrip[]>();
  for (const trip of trips) days.set(trip.date, [...(days.get(trip.date) ?? []), trip]);

  return (
    <div className="space-y-5">
      {!uploadsEnabled && (
        <p className="rounded-2xl bg-[var(--color-mist)] p-4 text-sm">
          Photo uploads aren’t connected to Google Drive yet. Let Travis know.
        </p>
      )}
      {trips.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-[var(--color-ink)]/15 p-6 text-center text-sm text-[var(--color-ink-soft)]">
          No trips in the last week.
        </p>
      ) : (
        [...days.entries()].map(([date, list]) => {
          const heading = dayHeading(date, today);
          return (
            <section key={date} aria-label={`${heading.lead}, ${heading.date}`}>
              <h2 className="mb-2 flex items-baseline gap-2">
                <span className="text-display text-lg">{heading.lead}</span>
                <span className="text-sm text-[var(--color-ink-soft)]">{heading.date}</span>
              </h2>
              <ul className="space-y-2">
                {list.map((trip) => (
                  <TripCard key={trip.id} trip={trip} uploadsEnabled={uploadsEnabled} />
                ))}
              </ul>
            </section>
          );
        })
      )}
    </div>
  );
}

interface Progress {
  total: number;
  done: number;
  failed: number;
  bytesTotal: number;
  bytesDone: number;
}

function TripCard({ trip, uploadsEnabled }: { trip: RecentTrip; uploadsEnabled: boolean }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  // Local counts move immediately; the server's catch up (and include other
  // crew's uploads) on the next refresh.
  const [uploadedHere, setUploadedHere] = useState(trip.photos.photoCount);
  const [markedHere, setMarkedHere] = useState(false);
  const photoCount = Math.max(uploadedHere, trip.photos.photoCount);
  const ready = trip.photos.readyAt
    ? { by: trip.photos.readyBy }
    : markedHere
      ? { by: null }
      : null;
  const [progress, setProgress] = useState<Progress | null>(null);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<{ kind: 'ok' | 'err'; message: string } | null>(null);

  const heading = tripHeading(trip);
  const uploading = progress !== null && progress.done + progress.failed < progress.total;

  async function upload(picked: File[]) {
    setFlash(null);
    const files = picked.filter((f) => mimeTypeOf(f));
    const skipped = picked.length - files.length;
    if (files.length === 0) {
      setFlash({ kind: 'err', message: 'Those aren’t photos or videos.' });
      return;
    }

    const loaded = new Map<File, number>();
    const state: Progress = {
      total: files.length,
      done: 0,
      failed: 0,
      bytesTotal: files.reduce((sum, f) => sum + f.size, 0),
      bytesDone: 0,
    };
    const publish = () => {
      state.bytesDone = [...loaded.values()].reduce((a, b) => a + b, 0);
      setProgress({ ...state });
    };
    publish();

    // Keep the screen on so the phone doesn't sleep mid-upload.
    const wakeLock = await navigator.wakeLock?.request('screen').catch(() => null);
    const warnOnLeave = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warnOnLeave);

    async function uploadOne(file: File, url: string): Promise<void> {
      try {
        await putFile(url, file, (n) => {
          loaded.set(file, n);
          publish();
        });
      } catch {
        // One retry with a fresh upload URL — phones drop connections.
        loaded.set(file, 0);
        const { uploadUrls } = await photosApi<{ uploadUrls: string[] }>({
          action: 'start',
          tripId: trip.id,
          files: [{ name: file.name, mimeType: mimeTypeOf(file), size: file.size }],
        });
        await putFile(uploadUrls[0]!, file, (n) => {
          loaded.set(file, n);
          publish();
        });
      }
      loaded.set(file, file.size);
      state.done++;
      publish();
      setUploadedHere((c) => c + 1);
      photosApi({ action: 'uploaded', tripId: trip.id, count: 1 }).catch(() => undefined);
    }

    let fatal: string | null = null;
    try {
      for (let i = 0; i < files.length; i += SESSION_BATCH) {
        const batch = files.slice(i, i + SESSION_BATCH);
        const { uploadUrls } = await photosApi<{ uploadUrls: string[] }>({
          action: 'start',
          tripId: trip.id,
          files: batch.map((f) => ({ name: f.name, mimeType: mimeTypeOf(f), size: f.size })),
        });
        const queue = batch.map((file, j) => ({ file, url: uploadUrls[j]! }));
        await Promise.all(
          Array.from({ length: PARALLEL_UPLOADS }, async () => {
            for (let next = queue.shift(); next; next = queue.shift()) {
              await uploadOne(next.file, next.url).catch(() => {
                state.failed++;
                publish();
              });
            }
          }),
        );
      }
    } catch (err) {
      fatal = err instanceof Error ? err.message : 'Upload failed.';
      state.failed = state.total - state.done;
      publish();
    } finally {
      window.removeEventListener('beforeunload', warnOnLeave);
      await wakeLock?.release().catch(() => undefined);
    }

    const notes = [
      state.done > 0 && `${state.done} uploaded.`,
      state.failed > 0 && `${state.failed} didn’t make it — tap “Add photos” and pick those again.`,
      skipped > 0 && `${skipped} skipped (not a photo or video).`,
    ].filter(Boolean);
    setFlash({
      kind: fatal || state.failed > 0 ? 'err' : 'ok',
      message: fatal ? `${fatal} ${notes.join(' ')}` : notes.join(' '),
    });
    setProgress(null);
    router.refresh();
  }

  async function markReady() {
    if (
      !confirm(
        `Mark the photos ready to send? They'll be emailed to the ${trip.guests} ${trip.guests === 1 ? 'guest' : 'guests'} from this trip.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setFlash(null);
    try {
      await photosApi({ action: 'ready', tripId: trip.id });
      setMarkedHere(true);
      setFlash({ kind: 'ok', message: 'Marked ready. The guests will get their photos soon.' });
      router.refresh();
    } catch (err) {
      setFlash({ kind: 'err', message: err instanceof Error ? err.message : 'Something went wrong.' });
    } finally {
      setBusy(false);
    }
  }

  const percent =
    progress && progress.bytesTotal > 0
      ? Math.round((progress.bytesDone / progress.bytesTotal) * 100)
      : 0;

  return (
    <li className="rounded-2xl border border-[var(--color-ink)]/8 bg-white p-4 shadow-[var(--shadow-card)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold">{heading.time}</p>
          <p className="text-sm text-[var(--color-ink-soft)]">
            {heading.tour} · {trip.guests} {trip.guests === 1 ? 'guest' : 'guests'}
          </p>
        </div>
        <span
          className={clsx(
            'shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold',
            ready
              ? 'bg-[var(--color-spring-deep)] text-white'
              : photoCount > 0
                ? 'bg-[var(--color-mist)] text-[var(--color-spring)]'
                : 'bg-[var(--color-sand)] text-[var(--color-ink-soft)]',
          )}
        >
          {ready ? 'Ready to send' : photoCount > 0 ? `${photoCount} uploaded` : 'No photos yet'}
        </span>
      </div>

      {ready && (
        <p className="mt-2 text-xs text-[var(--color-ink-soft)]">
          {photoCount} {photoCount === 1 ? 'photo' : 'photos'} uploaded
          {ready.by ? ` · marked ready by ${ready.by}` : ''}. Photos added
          now may miss the guests’ email.
        </p>
      )}

      {progress && (
        <div className="mt-3" role="status" aria-live="polite">
          <div className="flex justify-between text-xs text-[var(--color-ink-soft)]">
            <span>
              Uploading {Math.min(progress.done + progress.failed + 1, progress.total)} of {progress.total}…
            </span>
            <span>{percent}%</span>
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-[var(--color-sand)]">
            <div
              className="h-full rounded-full bg-[var(--color-spring)] transition-[width] duration-300"
              style={{ width: `${percent}%` }}
            />
          </div>
          <p className="mt-1 text-xs text-[var(--color-ink-soft)]">
            Keep the app open until it finishes.
          </p>
        </div>
      )}

      {uploadsEnabled && !progress && (
        <div className="mt-3 flex gap-2">
          <input
            ref={inputRef}
            type="file"
            accept="image/*,video/*"
            multiple
            className="sr-only"
            tabIndex={-1}
            onChange={(e) => {
              const picked = Array.from(e.target.files ?? []);
              e.target.value = '';
              if (picked.length > 0) void upload(picked);
            }}
          />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={busy || uploading}
            className={clsx(
              'inline-flex h-10 flex-1 items-center justify-center rounded-[10px] px-4 text-sm font-semibold disabled:opacity-60',
              photoCount > 0
                ? 'border border-[var(--color-ink)]/20 hover:border-[var(--color-ink)]'
                : 'bg-[var(--color-buoy)] text-[var(--color-ink)] hover:bg-[var(--color-buoy-deep)]',
            )}
          >
            {photoCount > 0 ? 'Add more photos' : 'Add photos'}
          </button>
          {photoCount > 0 && !ready && (
            <button
              type="button"
              onClick={markReady}
              disabled={busy}
              className="inline-flex h-10 flex-1 items-center justify-center rounded-[10px] bg-[var(--color-spring)] px-4 text-sm font-semibold text-white hover:bg-[var(--color-spring-deep)] disabled:opacity-60"
            >
              {busy ? 'Marking…' : 'Photos are all in'}
            </button>
          )}
        </div>
      )}

      {flash && (
        <p
          role={flash.kind === 'err' ? 'alert' : 'status'}
          className={clsx(
            'mt-2 text-sm',
            flash.kind === 'err' ? 'text-[var(--color-error)]' : 'text-[var(--color-spring)]',
          )}
        >
          {flash.message}
        </p>
      )}
    </li>
  );
}

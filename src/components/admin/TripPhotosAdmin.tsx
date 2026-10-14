'use client';

/* eslint-disable @next/next/no-img-element -- admin thumbnails straight from Storage download URLs */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { admin } from '@/lib/admin-client';
import {
  getTripPhotos,
  listBookingsBetween,
  listTripPhotosBetween,
  type BookingDoc,
  type TripFileDoc,
  type TripPhotosDoc,
} from '@/lib/admin-firestore';
import { FunctionError } from '@/lib/functions-client';
import { marinaNow } from '@/lib/availability';
import { formatFriendlyDate } from '@/lib/date';
import { storageFileUrl } from '@/lib/storage-url';
import { departureMinutes, departureTime, shortDate } from './booking-labels';

const card = 'bg-white rounded-2xl border border-[var(--color-ink)]/8 shadow-[var(--shadow-card)]';
const quietButton =
  'inline-flex items-center justify-center min-h-11 px-4 py-2 rounded-[10px] border border-[var(--color-ink)]/15 text-sm font-medium hover:bg-[var(--color-ink)]/5 disabled:opacity-60';

function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + n)).toISOString().slice(0, 10);
}

function fileUrl(f: TripFileDoc): string {
  return storageFileUrl(
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? '',
    f.storagePath,
    f.downloadToken,
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_EMULATOR_HOST,
  );
}

/** Copy, text, or open the crew's upload link. */
export function UploadLinkActions({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  const message = `Upload this trip's photos and videos here (no sign-in): ${url}`;
  return (
    <div className="space-y-2">
      <p className="break-all rounded-xl bg-[var(--color-paper)] px-3 py-2 font-mono text-xs">{url}</p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(url);
              setCopied(true);
            } catch {
              setCopied(false);
            }
          }}
          className={quietButton}
        >
          {copied ? 'Copied' : 'Copy link'}
        </button>
        <a href={`sms:?&body=${encodeURIComponent(message)}`} className={quietButton}>
          Text it
        </a>
        <a href={url} target="_blank" rel="noopener noreferrer" className={quietButton}>
          Open
        </a>
      </div>
    </div>
  );
}

const DRIVE_LABEL: Record<NonNullable<TripFileDoc['drive']>['status'], string> = {
  copied: 'In Drive',
  pending: 'Copying to Drive…',
  failed: 'Drive copy failed (retrying)',
  'not-connected': 'Not in Drive (not connected)',
};

/**
 * Admin → Trip photos → one departure: what the crew uploaded, as guests
 * see it, with delete. Deleting takes the file out of the gallery and
 * Storage, and removes its Drive copy.
 */
export function TripPhotosAdmin({ tripId }: { tripId: string }) {
  const [data, setData] = useState<{ trip: TripPhotosDoc | null; files: TripFileDoc[] } | null>(null);
  const [uploadUrl, setUploadUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [date, timeSlot] = tripId.split('_') as [string, string];

  const load = useCallback(async () => {
    try {
      setData(await getTripPhotos(tripId));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t load the photos.');
    }
  }, [tripId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load
    load();
    admin
      .tripUploadLink(date, timeSlot)
      .then((r) => setUploadUrl(r.uploadUrl))
      .catch(() => setUploadUrl(null));
  }, [load, date, timeSlot]);

  async function remove(f: TripFileDoc) {
    if (!confirm(`Delete ${f.name}? Guests won’t see it any more, and it’s removed from Google Drive too.`)) return;
    setDeleting(f.id);
    try {
      await admin.deleteTripPhoto(tripId, f.id);
      await load();
    } catch (err) {
      setError(err instanceof FunctionError ? err.message : 'That didn’t delete. Try again.');
    } finally {
      setDeleting(null);
    }
  }

  const slot = { tourId: '', timeSlot };

  return (
    <div className="space-y-5">
      <header>
        <Link href="/admin/trip-photos" className="text-sm text-[var(--color-brand-blue)] underline underline-offset-4">
          All trips
        </Link>
        <h1 className="text-display text-[1.75rem] sm:text-[2.25rem] leading-tight mt-1">
          {formatFriendlyDate(date)}, {departureTime(slot)}
        </h1>
        <p className="text-sm text-[var(--color-ink-soft)]">
          {data?.files.length ?? 0} {data?.files.length === 1 ? 'photo or video' : 'photos and videos'}. Every party on this
          departure sees these in their gallery.
        </p>
      </header>

      {error && (
        <p role="alert" className="rounded-2xl bg-[var(--color-coral)]/10 border border-[var(--color-coral)]/30 p-3 text-sm">
          {error}
        </p>
      )}

      <section className={`${card} p-5 space-y-2`}>
        <h2 className="font-display text-lg">Crew upload link</h2>
        <p className="text-sm text-[var(--color-ink-soft)]">
          No sign-in needed. Works until a week after the trip.
        </p>
        {uploadUrl ? <UploadLinkActions url={uploadUrl} /> : <p className="text-sm animate-pulse">Getting the link…</p>}
        {data?.trip?.driveFolderUrl && (
          <a
            href={data.trip.driveFolderUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block text-sm text-[var(--color-brand-blue)] underline underline-offset-4"
          >
            Open this trip’s Google Drive folder
          </a>
        )}
      </section>

      {data === null && !error && <p className="text-sm text-[var(--color-ink-soft)] animate-pulse">Loading photos…</p>}
      {data && data.files.length === 0 && (
        <p className={`${card} p-5 text-sm text-[var(--color-ink-soft)]`}>Nothing uploaded for this trip yet.</p>
      )}
      {data && data.files.length > 0 && (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {data.files.map((f) => (
            <li key={f.id} className={`${card} overflow-hidden`}>
              <div className="aspect-square bg-[var(--color-ink)]/5">
                {f.contentType.startsWith('video/') ? (
                  <video src={fileUrl(f)} controls playsInline preload="metadata" className="h-full w-full object-cover" />
                ) : (
                  <a href={fileUrl(f)} target="_blank" rel="noopener noreferrer">
                    <img src={fileUrl(f)} alt={f.name} loading="lazy" className="h-full w-full object-cover" />
                  </a>
                )}
              </div>
              <div className="p-2 space-y-1">
                <p className="truncate text-xs" title={f.name}>
                  {f.name}
                </p>
                <p className="text-xs text-[var(--color-ink-soft)]">{DRIVE_LABEL[f.drive?.status ?? 'pending']}</p>
                <button
                  type="button"
                  onClick={() => remove(f)}
                  disabled={deleting !== null}
                  className={`${quietButton} w-full text-[var(--color-coral-dark)]`}
                >
                  {deleting === f.id ? 'Deleting…' : 'Delete'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Admin → Trip photos: recent and upcoming departures, with photo counts. */
export function TripPhotosList() {
  const [rows, setRows] = useState<
    Array<{ tripId: string; date: string; first: BookingDoc; guests: number; photos: number }> | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const today = marinaNow().date;

  useEffect(() => {
    const from = addDays(today, -7);
    const to = addDays(today, 1);
    Promise.all([listBookingsBetween(from, to), listTripPhotosBetween(from, to)])
      .then(([bookings, photos]) => {
        const counts = new Map(photos.map((p) => [p.id, p.photoCount ?? 0]));
        const trips = new Map<string, { tripId: string; date: string; first: BookingDoc; guests: number; photos: number }>();
        for (const b of bookings) {
          if (b.status !== 'confirmed' && b.status !== 'completed') continue;
          const id = `${b.date}_${b.timeSlot}`;
          const t = trips.get(id);
          if (t) t.guests += b.guestCount;
          else trips.set(id, { tripId: id, date: b.date, first: b, guests: b.guestCount, photos: counts.get(id) ?? 0 });
        }
        setRows(
          [...trips.values()].sort(
            (a, b) => b.date.localeCompare(a.date) || departureMinutes(a.first) - departureMinutes(b.first),
          ),
        );
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Couldn’t load trips.'));
  }, [today]);

  if (error) {
    return (
      <p role="alert" className="rounded-2xl bg-[var(--color-coral)]/10 border border-[var(--color-coral)]/30 p-3 text-sm">
        {error}
      </p>
    );
  }
  if (!rows) {
    return <div className={`${card} p-6 text-center text-sm text-[var(--color-ink-soft)] animate-pulse`}>Loading trips…</div>;
  }
  if (rows.length === 0) {
    return <p className={`${card} p-5 text-sm text-[var(--color-ink-soft)]`}>No trips this past week or tomorrow.</p>;
  }
  return (
    <ul className={`${card} divide-y divide-[var(--color-ink)]/8`}>
      {rows.map((r) => (
        <li key={r.tripId}>
          <Link href={`/admin/trip-photos/${r.tripId}`} className="flex items-center justify-between gap-3 px-5 py-4 hover:bg-[var(--color-ink)]/3">
            <span>
              <span className="font-semibold">
                {shortDate(r.date, { relative: true })}, {departureTime(r.first)}
              </span>
              <span className="block text-sm text-[var(--color-ink-soft)]">
                {r.first.tourName} · {r.guests} {r.guests === 1 ? 'guest' : 'guests'}
              </span>
            </span>
            <span className="text-sm font-medium tabular-nums">
              {r.photos} {r.photos === 1 ? 'photo' : 'photos'}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

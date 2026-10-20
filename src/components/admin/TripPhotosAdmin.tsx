'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
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
import { departureMinutes, departureTime, goingAhead, shortDate } from './booking-labels';

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

/**
 * A booking whose guests went out (or will): the same rule as the crew app,
 * the 8 PM crew email and the guest gallery (onTheBoat in
 * src/lib/trip-photos-server.ts). Old-site deposits count; a booking still
 * `closure`d is on a departure Travis called off.
 */
export function onTheBoat(b: BookingDoc): boolean {
  if (b.closure && b.status !== 'completed') return false;
  return goingAhead(b) || b.status === 'completed';
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
  // Drive signed out or refused it (full, say): it goes once Settings shows Drive working again.
  'not-connected': 'Waiting for Drive (see Settings)',
};

/** The functions stop retrying a copy after this many tries (MAX_DRIVE_ATTEMPTS in functions/src/tripPhotos.ts). */
const MAX_DRIVE_ATTEMPTS = 5;

function driveLabel(f: TripFileDoc): string {
  if (f.drive?.status === 'failed' && (f.drive.attempts ?? 0) >= MAX_DRIVE_ATTEMPTS) return 'Drive copy failed (gave up)';
  return DRIVE_LABEL[f.drive?.status ?? 'pending'];
}

/**
 * Admin → Trip photos → one departure: what the crew uploaded, as guests
 * see it, with delete. Deleting takes the file out of the gallery and
 * Storage, and removes its Drive copy, or says it couldn't (Drive not
 * connected, or the delete failed): nothing tries that again later.
 */
export function TripPhotosAdmin({ tripId }: { tripId: string }) {
  const [data, setData] = useState<{ trip: TripPhotosDoc | null; files: TripFileDoc[] } | null>(null);
  const [uploadUrl, setUploadUrl] = useState<string | null>(null);
  const [linkFailed, setLinkFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deleted, setDeleted] = useState<string | null>(null);
  /** A deleted photo whose Drive copy is still there, and why. */
  const [driveLeft, setDriveLeft] = useState<{ name: string; why: 'not-connected' | 'failed' } | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const emptyRef = useRef<HTMLParagraphElement>(null);
  /** Where the tile just deleted was. */
  const refocusAt = useRef<number | null>(null);
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
      .catch(() => setLinkFailed(true));
  }, [load, date, timeSlot]);

  // A deleted tile takes its Delete button with it: focus goes to the tile
  // that takes its place (or the one before, or the empty message) instead
  // of to the page, and the hidden status line says what went.
  useEffect(() => {
    const at = refocusAt.current;
    if (at === null || !data) return;
    refocusAt.current = null;
    const tiles = listRef.current?.children;
    const tile = tiles?.[Math.min(at, tiles.length - 1)];
    (tile?.querySelector<HTMLElement>('a, video') ?? emptyRef.current)?.focus();
  }, [data]);

  async function remove(f: TripFileDoc) {
    if (!confirm(`Delete ${f.name}? Guests won’t see it any more, and it’s removed from Google Drive too.`)) return;
    setDeleting(f.id);
    setDeleted(null);
    setDriveLeft(null);
    try {
      const result = await admin.deleteTripPhoto(tripId, f.id);
      refocusAt.current = Math.max(0, data?.files.findIndex((x) => x.id === f.id) ?? 0);
      setDeleted(f.name);
      if (result.driveCopyLeft) setDriveLeft({ name: f.name, why: result.driveCopyLeft });
      await load();
    } catch (err) {
      setError(err instanceof FunctionError ? err.message : 'That didn’t delete. Try again.');
    } finally {
      setDeleting(null);
    }
  }

  const slot = { timeSlot, date };

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
      <p role="status" className="sr-only">
        {deleted && `Deleted ${deleted}.`}
      </p>
      {driveLeft && (
        <p role="alert" className="rounded-2xl bg-[var(--color-coral)]/10 border border-[var(--color-coral)]/30 p-3 text-sm">
          {driveLeft.name} is out of the gallery, but its copy is still in Google Drive:{' '}
          {driveLeft.why === 'not-connected'
            ? 'Drive isn’t connected (see Settings).'
            : 'Drive didn’t take the delete.'}{' '}
          Delete it from{' '}
          {data?.trip?.folderUrl ? (
            <a href={data.trip.folderUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">
              this trip’s Drive folder
            </a>
          ) : (
            'this trip’s Drive folder'
          )}{' '}
          yourself. (The blog already leaves it out.)
        </p>
      )}

      <section className={`${card} p-5 space-y-2`}>
        <h2 className="font-display text-lg">Crew upload link</h2>
        <p className="text-sm text-[var(--color-ink-soft)]">
          No sign-in needed. Works until a week after the trip.
        </p>
        {uploadUrl ? (
          <UploadLinkActions url={uploadUrl} />
        ) : linkFailed ? (
          <p className="text-sm text-[var(--color-coral-dark)]">Couldn’t get the upload link. Reload to try again.</p>
        ) : (
          <p className="text-sm animate-pulse">Getting the link…</p>
        )}
        {data?.trip?.folderUrl && (
          <a
            href={data.trip.folderUrl}
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
        <p ref={emptyRef} tabIndex={-1} className={`${card} p-5 text-sm text-[var(--color-ink-soft)] outline-none`}>
          Nothing uploaded for this trip yet.
        </p>
      )}
      {data && data.files.length > 0 && (
        <ul ref={listRef} className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {data.files.map((f) => (
            <li key={f.id} className={`${card} overflow-hidden`}>
              <div className="relative aspect-square bg-[var(--color-ink)]/5">
                {f.contentType.startsWith('video/') ? (
                  <video
                    src={fileUrl(f)}
                    controls
                    playsInline
                    preload="metadata"
                    className="focus-inset h-full w-full object-cover"
                    aria-label={f.name}
                  />
                ) : (
                  // As in the guest gallery (TripGallery): a resized thumbnail,
                  // not the several-MB original, in a link that fills the tile
                  // so its focus ring shows, with the image beneath the ring.
                  <a
                    href={fileUrl(f)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="focus-inset absolute inset-0 block isolate"
                  >
                    <Image
                      src={fileUrl(f)}
                      alt={f.name}
                      fill
                      sizes="(min-width: 640px) 300px, 50vw"
                      // The local Storage emulator isn't an allowed image host.
                      unoptimized={fileUrl(f).startsWith('http://')}
                      className="-z-10 object-cover"
                    />
                  </a>
                )}
              </div>
              <div className="p-2 space-y-1">
                <p className="truncate text-xs" title={f.name}>
                  {f.name}
                </p>
                <p className="text-xs text-[var(--color-ink-soft)]">{driveLabel(f)}</p>
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

/**
 * "6 guests". Old-site bookings with no party size on file (guestCount 0)
 * aren't in the count, so as in the crew app it reads "4+ guests", or
 * "party size unknown" when none are known.
 */
function guestsText(guests: number, unknownParty: number): string {
  if (unknownParty === 0) return `${guests} ${guests === 1 ? 'guest' : 'guests'}`;
  return guests > 0 ? `${guests}+ guests` : 'party size unknown';
}

/** One departure in the list. `unknownParty`: its bookings with no party size on file. */
interface TripRow {
  tripId: string;
  date: string;
  first: BookingDoc;
  guests: number;
  unknownParty: number;
  photos: number;
}

/** Admin → Trip photos: recent and upcoming departures, with photo counts. */
export function TripPhotosList() {
  const [rows, setRows] = useState<TripRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const today = marinaNow().date;

  useEffect(() => {
    const from = addDays(today, -7);
    const to = addDays(today, 1);
    Promise.all([listBookingsBetween(from, to), listTripPhotosBetween(from, to)])
      .then(([bookings, photos]) => {
        const counts = new Map(photos.map((p) => [p.id, p.photoCount ?? 0]));
        const trips = new Map<string, TripRow>();
        for (const b of bookings) {
          if (!onTheBoat(b)) continue;
          const id = `${b.date}_${b.timeSlot}`;
          const t = trips.get(id) ?? { tripId: id, date: b.date, first: b, guests: 0, unknownParty: 0, photos: counts.get(id) ?? 0 };
          if (b.guestCount > 0) t.guests += b.guestCount;
          else t.unknownParty += 1;
          trips.set(id, t);
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
                {r.first.tourName} · {guestsText(r.guests, r.unknownParty)}
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

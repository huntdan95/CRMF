'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { admin } from '@/lib/admin-client';
import type { BookingDoc } from '@/lib/admin-firestore';
import { marinaNow } from '@/lib/availability';
import { UploadLinkActions, onTheBoat } from './TripPhotosAdmin';

function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + n)).toISOString().slice(0, 10);
}

/**
 * The booking page's "Trip photos" card: the crew's upload link for this
 * departure (shared by every party on the boat) and a link to what's been
 * uploaded. Only for a trip that's running (old-site deposits too, as the
 * crew app counts them), up to a week after it.
 */
export function BookingTripPhotos({ booking }: { booking: BookingDoc }) {
  const today = marinaNow().date;
  const eligible = onTheBoat(booking) && booking.date >= addDays(today, -7);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const tripId = `${booking.date}_${booking.timeSlot}`;

  useEffect(() => {
    if (!eligible) return;
    admin
      .tripUploadLink(booking.date, booking.timeSlot)
      .then((r) => setUrl(r.uploadUrl))
      .catch(() => setError(true));
  }, [eligible, booking.date, booking.timeSlot]);

  if (!eligible) return null;

  return (
    <div className="bg-white rounded-2xl border border-[var(--color-ink)]/8 shadow-[var(--shadow-card)] p-5 lg:col-span-2 space-y-3">
      <h3 className="font-display text-base">Trip photos</h3>
      <p className="text-sm text-[var(--color-ink-soft)]">
        The crew’s upload link for this departure. No sign-in needed; it works
        until a week after the trip. Guests get their photos by email.
      </p>
      {url ? (
        <UploadLinkActions url={url} />
      ) : error ? (
        <p className="text-sm text-[var(--color-coral-dark)]">Couldn’t get the upload link. Reload to try again.</p>
      ) : (
        <p className="text-sm animate-pulse">Getting the link…</p>
      )}
      <Link
        href={`/admin/trip-photos/${tripId}`}
        className="inline-block text-sm text-[var(--color-brand-blue)] underline underline-offset-4"
      >
        See this trip’s photos
      </Link>
    </div>
  );
}

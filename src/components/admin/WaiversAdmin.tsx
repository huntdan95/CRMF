'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { listBookingsBetween, type BookingDoc } from '@/lib/admin-firestore';
import { listWaiversForBookings, signedAtLabel, type WaiverDoc } from '@/lib/admin-waivers';
import { marinaNow } from '@/lib/availability';
import { clsx } from '@/lib/clsx';
import { slotLabels } from '@/lib/tours';
import { WAIVER_REVIEW, WAIVER_VERSION } from '@/lib/waiver/agreement';
import { nameKey, waiverCoverage, type Coverage } from '@/lib/waiver/people';
import { departureMinutes, departureTime } from './booking-labels';

const WINDOW_DAYS = 14;
const ON_THE_BOAT = new Set<BookingDoc['status']>(['confirmed', 'completed']);

function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

function dayLabel(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

/** When the trip leaves on its date: the sunset cruise's time moves with the sun. */
function slotStart(slot: string, date: string): { sort: number; display: string } {
  const trip = { timeSlot: slot, date };
  return { sort: departureMinutes(trip), display: departureTime(trip) };
}

interface Trip {
  id: string;
  date: string;
  timeSlot: string;
  bookings: Array<{ booking: BookingDoc; coverage: Coverage }>;
  signed: number;
  needed: number;
}

/**
 * Admin → Waivers: every trip in a two-week window with how many people on
 * it have signed, and a name search across the signed waivers.
 */
export function WaiversAdmin() {
  const today = marinaNow().date;
  const [start, setStart] = useState(today);
  const [loaded, setLoaded] = useState<{ start: string; bookings: BookingDoc[]; waivers: WaiverDoc[] } | null>(null);
  const [failed, setFailed] = useState<{ start: string; message: string } | null>(null);
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [search, setSearch] = useState('');

  const end = addDays(start, WINDOW_DAYS - 1);

  useEffect(() => {
    let live = true;
    // Waivers by booking rather than by their signed-for date, so a booking
    // that was moved into (or out of) these two weeks brings its own.
    listBookingsBetween(start, end)
      .then(async (bookings) => {
        const waivers = await listWaiversForBookings(bookings.map((b) => b.id));
        if (live) setLoaded({ start, bookings, waivers });
      })
      .catch((err) => {
        if (live) setFailed({ start, message: err instanceof Error ? err.message : 'Failed to load.' });
      });
    return () => {
      live = false;
    };
  }, [start, end]);

  // Only show what was loaded for the dates on screen.
  const data = loaded?.start === start ? loaded : null;
  const error = failed?.start === start ? failed.message : null;

  const trips = useMemo<Trip[]>(() => {
    if (!data) return [];
    const byBooking = new Map<string, WaiverDoc[]>();
    for (const w of data.waivers) byBooking.set(w.bookingId, [...(byBooking.get(w.bookingId) ?? []), w]);

    const byTrip = new Map<string, Trip>();
    for (const b of data.bookings) {
      // Old-site deposit bookings are imported as pending-payment but are
      // real guests, as on the dashboard and the crew schedule.
      const legacyDeposit = b.status === 'pending-payment' && b.id.startsWith('legacy-');
      if (!ON_THE_BOAT.has(b.status) && !legacyDeposit) continue;
      const id = `${b.date}_${b.timeSlot}`;
      const coverage = waiverCoverage(b.guests, b.guestCount, byBooking.get(b.id) ?? []);
      const trip = byTrip.get(id) ?? { id, date: b.date, timeSlot: b.timeSlot, bookings: [], signed: 0, needed: 0 };
      trip.bookings.push({ booking: b, coverage });
      trip.signed += coverage.signedCount;
      trip.needed += coverage.needed;
      byTrip.set(id, trip);
    }
    return [...byTrip.values()].sort(
      (a, b) =>
        a.date.localeCompare(b.date) || slotStart(a.timeSlot, a.date).sort - slotStart(b.timeSlot, b.date).sort,
    );
  }, [data]);

  const shown = onlyMissing ? trips.filter((t) => t.signed < t.needed) : trips;

  const bookingDates = useMemo(
    () => new Map((data?.bookings ?? []).map((b) => [b.id, { date: b.date, timeSlot: b.timeSlot }])),
    [data],
  );

  const matches = useMemo(() => {
    const q = nameKey(search);
    if (!data || q.length < 2) return null;
    return data.waivers.filter(
      (w) => nameKey(w.signer.name).includes(q) || w.minors.some((m) => nameKey(m.name).includes(q)),
    );
  }, [data, search]);

  return (
    <div className="space-y-5">
      {!WAIVER_REVIEW && (
        <div className="rounded-2xl border border-[var(--color-coral)]/30 bg-[var(--color-coral)]/10 p-4 text-sm">
          <p className="font-semibold">The waiver text hasn’t been signed off by a lawyer yet.</p>
          <p className="mt-1">
            Guests are signing version {WAIVER_VERSION}, adapted from your insurer’s form for Florida
            law. Have a Florida attorney (one who handles boating cases) and your insurer approve it,
            then record that in <code className="font-mono text-xs">src/lib/waiver/agreement.ts</code>.
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3 bg-white rounded-2xl border border-[var(--color-ink)]/8 shadow-[var(--shadow-card)] p-4">
        <div>
          <label htmlFor="waivers-from" className="block text-xs text-[var(--color-ink-soft)] mb-1">
            Trips from
          </label>
          <input
            id="waivers-from"
            type="date"
            value={start}
            onChange={(e) => e.target.value && setStart(e.target.value)}
            className="rounded-xl border border-[var(--color-ink)]/15 bg-white px-3 py-2 text-base"
          />
        </div>
        <div className="flex gap-2">
          <NavBtn onClick={() => setStart(addDays(start, -WINDOW_DAYS))}>← 2 weeks</NavBtn>
          <NavBtn onClick={() => setStart(today)}>Today</NavBtn>
          <NavBtn onClick={() => setStart(addDays(start, WINDOW_DAYS))}>2 weeks →</NavBtn>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={onlyMissing}
            onChange={(e) => setOnlyMissing(e.target.checked)}
            className="h-4 w-4 accent-[var(--color-brand-blue)]"
          />
          Only trips missing waivers
        </label>
        <div className="grow min-w-[12rem]">
          <label htmlFor="waivers-search" className="block text-xs text-[var(--color-ink-soft)] mb-1">
            Find a signed waiver by name
          </label>
          <input
            id="waivers-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Name, in these two weeks"
            className="w-full rounded-xl border border-[var(--color-ink)]/15 bg-white px-3 py-2 text-base"
          />
        </div>
      </div>

      <p className="text-sm text-[var(--color-ink-soft)]">
        {dayLabel(start)} – {dayLabel(end)}
      </p>

      {error && (
        <div className="rounded-2xl border border-[var(--color-coral)]/30 bg-[var(--color-coral)]/10 p-4 text-sm">
          {error}
        </div>
      )}
      {!data && !error && (
        <div className="bg-white rounded-2xl border border-[var(--color-ink)]/8 p-8 text-center text-sm text-[var(--color-ink-soft)] animate-pulse">
          Loading trips…
        </div>
      )}

      {matches && (
        <section className="bg-white rounded-2xl border border-[var(--color-ink)]/8 shadow-[var(--shadow-card)] p-5">
          <h2 className="font-display text-base mb-3">Signed waivers matching “{search.trim()}”</h2>
          {matches.length === 0 ? (
            <p className="text-sm text-[var(--color-ink-soft)]">
              None in these two weeks. Move the dates to search other trips.
            </p>
          ) : (
            <ul className="divide-y divide-[var(--color-ink)]/8 text-sm">
              {matches.map((w) => (
                <li key={w.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <div>
                    <p className="font-medium">
                      {w.signer.name}
                      {w.minors.length > 0 && (
                        <span className="font-normal text-[var(--color-ink-soft)]">
                          {' '}
                          for {w.minors.map((m) => m.name).join(', ')}
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-[var(--color-ink-soft)]">
                      {/* The booking's date now, not the one it was signed for (it may have moved). */}
                      Trip {dayLabel(bookingDates.get(w.bookingId)?.date ?? w.tripDate)}{' '}
                      {slotStart(bookingDates.get(w.bookingId)?.timeSlot ?? w.timeSlot, bookingDates.get(w.bookingId)?.date ?? w.tripDate).display} · signed {signedAtLabel(w)}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Link
                      href={`/admin/bookings/${w.bookingId}`}
                      className="inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-medium border border-[var(--color-ink)]/15 hover:bg-[var(--color-ink)]/5"
                    >
                      Booking
                    </Link>
                    <a
                      href={`/admin/waivers/${w.id}/pdf`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-medium border border-[var(--color-ink)]/15 hover:bg-[var(--color-ink)]/5"
                    >
                      View PDF
                    </a>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {data && shown.length === 0 && (
        <div className="rounded-2xl border border-dashed border-[var(--color-ink)]/15 p-8 text-center text-sm text-[var(--color-ink-soft)]">
          {onlyMissing && trips.length > 0
            ? 'Every trip in these two weeks has all its waivers.'
            : 'No confirmed trips in these two weeks.'}
        </div>
      )}

      {shown.map((trip) => {
        const complete = trip.signed >= trip.needed;
        const tourNames = [...new Set(trip.bookings.map((b) => b.booking.tourName))].join(' · ');
        return (
          <section
            key={trip.id}
            className="bg-white rounded-2xl border border-[var(--color-ink)]/8 shadow-[var(--shadow-card)] p-5"
          >
            <header className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="font-display text-base">
                  {dayLabel(trip.date)} · {slotStart(trip.timeSlot, trip.date).display}{' '}
                  <span className="text-[var(--color-ink-soft)] font-normal">
                    {slotLabels[trip.timeSlot as keyof typeof slotLabels] ?? trip.timeSlot}
                  </span>
                </h2>
                <p className="text-xs text-[var(--color-ink-soft)]">{tourNames}</p>
              </div>
              <span
                className={clsx(
                  'inline-flex items-center px-3 py-1 rounded-full text-xs font-medium',
                  complete
                    ? 'bg-[var(--color-brand-blue)]/15 text-[var(--color-brand-blue-dark)]'
                    : 'bg-[var(--color-coral)]/15 text-[var(--color-coral-dark)]',
                )}
              >
                {complete ? 'All signed' : `${trip.signed} of ${trip.needed} signed`}
              </span>
            </header>
            <ul className="mt-3 divide-y divide-[var(--color-ink)]/8 text-sm">
              {trip.bookings.map(({ booking, coverage }) => {
                const missing = coverage.roster.filter((r) => !r.covered).map((r) => r.name);
                return (
                  <li key={booking.id} className="py-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <div className="min-w-0">
                      <Link
                        href={`/admin/bookings/${booking.id}`}
                        className="font-medium text-[var(--color-brand-blue)] hover:underline"
                      >
                        {booking.customerName}
                      </Link>
                      <span className="text-[var(--color-ink-soft)]">
                        {' '}
                        · {booking.guestCount} guest{booking.guestCount === 1 ? '' : 's'}
                      </span>
                      {missing.length > 0 && (
                        <p className="text-xs text-[var(--color-coral-dark)]">
                          Not signed: {missing.join(', ')}
                        </p>
                      )}
                    </div>
                    <span
                      className={clsx(
                        'text-xs font-medium',
                        coverage.signedCount >= coverage.needed
                          ? 'text-[var(--color-brand-blue-dark)]'
                          : 'text-[var(--color-coral-dark)]',
                      )}
                    >
                      {coverage.signedCount} / {coverage.needed}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function NavBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center px-3 py-2 rounded-xl text-sm font-medium border border-[var(--color-ink)]/15 hover:bg-[var(--color-ink)]/5"
    >
      {children}
    </button>
  );
}

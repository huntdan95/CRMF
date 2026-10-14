'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  listAllBookings,
  type BookingDoc,
} from '@/lib/admin-firestore';
import { marinaNow } from '@/lib/availability';
import { formatPrice } from '@/lib/tours';
import { clsx } from '@/lib/clsx';
import {
  STATUS_CLASS,
  departureMinutes,
  departureTime,
  isLegacy,
  partySize,
  shortDate,
  statusLabel,
} from './booking-labels';

type Tab = 'upcoming' | 'past' | 'cancelled' | 'all';

const TABS: Array<{ value: Tab; label: string }> = [
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'past', label: 'Past' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'all', label: 'All' },
];

/** Long lists render in pages so a phone doesn't draw 900 cards at once. */
const PAGE = 100;

function byTourTime(a: BookingDoc, b: BookingDoc): number {
  return a.date.localeCompare(b.date) || departureMinutes(a) - departureMinutes(b);
}

function matches(b: BookingDoc, q: string): boolean {
  const digits = q.replace(/\D/g, '');
  if (digits.length >= 3 && b.customerPhone.replace(/\D/g, '').includes(digits)) return true;
  if (digits && b.legacy && String(b.legacy.bookingId) === digits) return true;
  const haystack = `${b.customerName} ${b.customerEmail} ${b.tourName} ${b.date}`.toLowerCase();
  return haystack.includes(q.toLowerCase());
}

export function BookingsList() {
  const [rows, setRows] = useState<BookingDoc[] | null>(null);
  const [tab, setTab] = useState<Tab>('upcoming');
  const [search, setSearch] = useState('');
  const [shown, setShown] = useState(PAGE);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listAllBookings()
      .then(setRows)
      .catch(() => setError('Couldn’t load bookings. Check your signal and pull down to refresh.'));
  }, []);

  const today = marinaNow().date;
  const q = search.trim();

  const list = useMemo(() => {
    const all = rows ?? [];
    // A search looks through every booking, whichever tab is open.
    if (q) return all.filter((b) => matches(b, q)).sort((a, b) => byTourTime(b, a));
    switch (tab) {
      case 'upcoming':
        return all
          .filter((b) => b.date >= today && (b.status === 'confirmed' || b.status === 'pending-payment'))
          .sort(byTourTime);
      case 'past':
        return all
          .filter((b) => b.status !== 'cancelled' && (b.date < today || b.status === 'completed' || b.status === 'no-show'))
          .sort((a, b) => byTourTime(b, a));
      case 'cancelled':
        return all.filter((b) => b.status === 'cancelled').sort((a, b) => byTourTime(b, a));
      case 'all':
        return [...all].sort((a, b) => byTourTime(b, a));
    }
  }, [rows, tab, q, today]);

  return (
    <div className="space-y-4">
      <input
        type="search"
        placeholder="Search name, phone, email or old booking #"
        value={search}
        onChange={(e) => { setSearch(e.target.value); setShown(PAGE); }}
        className="rounded-[10px] border border-[var(--color-ink)]/15 bg-white px-4 py-3 text-base w-full"
      />

      {!q && (
        <div className="flex gap-1 overflow-x-auto -mx-1 px-1">
          {TABS.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => { setTab(t.value); setShown(PAGE); }}
              aria-pressed={tab === t.value}
              className={clsx(
                'shrink-0 px-4 py-2.5 rounded-full text-sm font-medium border',
                tab === t.value
                  ? 'bg-[var(--color-brand-blue)] text-white border-[var(--color-brand-blue)]'
                  : 'bg-white text-[var(--color-ink)] border-[var(--color-ink)]/15 hover:bg-[var(--color-ink)]/5',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {error && (
        <div role="alert" className="rounded-2xl bg-[var(--color-coral)]/10 border border-[var(--color-coral)]/30 p-3 text-sm">
          {error}
        </div>
      )}

      {rows === null && !error ? (
        <p className="text-sm text-[var(--color-ink-soft)] animate-pulse py-6 text-center">Loading bookings…</p>
      ) : list.length === 0 ? (
        <p className="text-sm text-[var(--color-ink-soft)] py-6 text-center bg-white rounded-2xl border border-[var(--color-ink)]/8">
          {q ? 'No bookings match that search.' : tab === 'upcoming' ? 'No upcoming bookings.' : 'Nothing here.'}
        </p>
      ) : (
        <>
          {q && (
            <p className="text-sm text-[var(--color-ink-soft)]">
              {list.length} booking{list.length === 1 ? '' : 's'} found
            </p>
          )}
          <ul className="grid gap-2 md:grid-cols-2">
            {list.slice(0, shown).map((b) => (
              <li key={b.id}>
                <Link
                  href={`/admin/bookings/${b.id}`}
                  className="block bg-white rounded-2xl border border-[var(--color-line)] shadow-[var(--shadow-panel)] px-4 py-3 hover:border-[var(--color-brand-blue)]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="font-medium text-[var(--color-brand-blue)] truncate">{b.customerName || 'No name given'}</p>
                    <span className={clsx('shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium', STATUS_CLASS[b.status])}>
                      {statusLabel(b)}
                    </span>
                  </div>
                  <p className="text-sm mt-0.5">
                    {shortDate(b.date, { relative: true, year: b.date.slice(0, 4) !== today.slice(0, 4) })} · {departureTime(b)} · {partySize(b)}
                  </p>
                  <p className="text-xs text-[var(--color-ink-soft)] mt-0.5 truncate">
                    {b.tourName}
                    {b.amountPaidCents > 0 && ` · paid ${formatPrice(b.amountPaidCents)}`}
                    {b.amountRefundedCents > 0 && `, refunded ${formatPrice(b.amountRefundedCents)}`}
                    {isLegacy(b) && ' · old website'}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
          {list.length > shown && (
            <button
              type="button"
              onClick={() => setShown((n) => n + PAGE)}
              className="w-full px-4 py-3 rounded-[10px] border border-[var(--color-ink)]/15 bg-white text-sm font-medium"
            >
              Show more ({list.length - shown} left)
            </button>
          )}
        </>
      )}
    </div>
  );
}

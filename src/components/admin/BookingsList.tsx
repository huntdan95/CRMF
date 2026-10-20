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
import { ChevronRight, Search } from '@/components/ui/icons';
import {
  statusTone,
  hasBouncedEmail,
  departureMinutes,
  departureTime,
  isLegacy,
  partySize,
  shortDate,
  statusLabel,
} from './booking-labels';
import { Badge, FilterTabs, TimeTile, buttonClass, inputClass, panelClass } from './ui';

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

function inTab(b: BookingDoc, tab: Tab, today: string): boolean {
  switch (tab) {
    case 'upcoming':
      return b.date >= today && (b.status === 'confirmed' || b.status === 'pending-payment');
    case 'past':
      return b.status !== 'cancelled' && (b.date < today || b.status === 'completed' || b.status === 'no-show');
    case 'cancelled':
      return b.status === 'cancelled';
    case 'all':
      return true;
  }
}

/** Runs of bookings on the same day, keeping the list's order. */
function byDay(list: BookingDoc[]): Array<{ date: string; bookings: BookingDoc[] }> {
  const days: Array<{ date: string; bookings: BookingDoc[] }> = [];
  for (const b of list) {
    const last = days[days.length - 1];
    if (last?.date === b.date) last.bookings.push(b);
    else days.push({ date: b.date, bookings: [b] });
  }
  return days;
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
    const inThisTab = all.filter((b) => inTab(b, tab, today));
    // Upcoming reads soonest first; everything else, latest first.
    return tab === 'upcoming' ? inThisTab.sort(byTourTime) : inThisTab.sort((a, b) => byTourTime(b, a));
  }, [rows, tab, q, today]);

  const counts = useMemo(
    () => Object.fromEntries(TABS.map((t) => [t.value, (rows ?? []).filter((b) => inTab(b, t.value, today)).length])),
    [rows, today],
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <label className="relative block sm:max-w-sm sm:flex-1">
          <span className="sr-only">Search bookings</span>
          <Search
            size={18}
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--color-ink-soft)]"
          />
          <input
            type="search"
            placeholder="Search name, phone, email or old booking #"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setShown(PAGE); }}
            className={clsx(inputClass, 'pl-10')}
          />
        </label>

        {!q && (
          <FilterTabs
            label="Show bookings"
            options={TABS.map((t) => ({ ...t, count: rows ? counts[t.value] : undefined }))}
            value={tab}
            onChange={(v) => { setTab(v); setShown(PAGE); }}
          />
        )}
      </div>

      {error && (
        <div role="alert" className="rounded-2xl bg-[var(--color-coral)]/10 border border-[var(--color-coral)]/30 p-3 text-sm">
          {error}
        </div>
      )}

      {rows === null && !error ? (
        <p className={clsx(panelClass, 'p-8 text-center text-sm text-[var(--color-ink-soft)] animate-pulse')}>
          Loading bookings…
        </p>
      ) : list.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-[var(--color-line-strong)] bg-white/50 p-8 text-center text-sm text-[var(--color-ink-soft)]">
          {q ? 'No bookings match that search.' : tab === 'upcoming' ? 'No upcoming bookings.' : 'Nothing here.'}
        </p>
      ) : (
        <>
          {q && (
            <p className="text-sm font-medium text-[var(--color-ink-soft)]">
              {list.length} booking{list.length === 1 ? '' : 's'} found
            </p>
          )}
          {byDay(list.slice(0, shown)).map(({ date, bookings }) => {
            const withYear = date.slice(0, 4) !== today.slice(0, 4);
            const relative = shortDate(date, { relative: true, year: withYear });
            const plain = shortDate(date, { year: withYear });
            return (
              <section key={date} aria-label={plain}>
                <div className="mb-2 flex items-baseline justify-between gap-3 px-1">
                  <h2 className="text-label text-[var(--color-ink-soft)]">
                    {relative !== plain && <span className="text-[var(--color-spring)]">{relative} · </span>}
                    {plain}
                  </h2>
                  <p className="text-xs text-[var(--color-ink-soft)]">
                    {bookings.length} booking{bookings.length === 1 ? '' : 's'}
                  </p>
                </div>
                <ul className={clsx(panelClass, 'overflow-hidden divide-y divide-[var(--color-line)]')}>
                  {bookings.map((b) => (
                    <li key={b.id}>
                      <Link
                        href={`/admin/bookings/${b.id}`}
                        className="flex items-center gap-4 px-4 py-3 sm:px-5 transition-colors hover:bg-[var(--color-paper)]/70"
                      >
                        <TimeTile time={departureTime(b)} size="sm" muted={b.status === 'cancelled'} />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <p className={clsx('font-semibold', b.status === 'cancelled' && 'text-[var(--color-ink-soft)]')}>
                              {b.customerName || 'No name given'}
                            </p>
                            <Badge tone={statusTone(b)}>{statusLabel(b)}</Badge>
                            {hasBouncedEmail(b) && <Badge tone="alert">Email bounced</Badge>}
                          </div>
                          <p className="mt-0.5 text-sm text-[var(--color-ink-soft)]">{b.tourName}</p>
                          <p className="text-xs text-[var(--color-ink-soft)]">
                            {partySize(b)}
                            {b.amountPaidCents > 0 && ` · paid ${formatPrice(b.amountPaidCents)}`}
                            {b.amountRefundedCents > 0 && `, refunded ${formatPrice(b.amountRefundedCents)}`}
                            {isLegacy(b) && ' · old website'}
                          </p>
                        </div>
                        <ChevronRight size={18} className="shrink-0 text-[var(--color-ink-soft)]" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
          {list.length > shown && (
            <button
              type="button"
              onClick={() => setShown((n) => n + PAGE)}
              className={clsx(buttonClass('secondary'), 'w-full')}
            >
              Show more ({list.length - shown} left)
            </button>
          )}
        </>
      )}
    </div>
  );
}

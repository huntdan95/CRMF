'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  countBookings,
  listBookingsById,
  listBookingsFrom,
  listBookingsPage,
  type BookingDoc,
  type LegacyBookingInfo,
} from '@/lib/admin-firestore';
import { bookingSearchRows, type BookingSearchRow } from '@/app/admin/(protected)/bookings/actions';
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
type OlderTab = Exclude<Tab, 'upcoming'>;

const TABS: Array<{ value: Tab; label: string }> = [
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'past', label: 'Past' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'all', label: 'All' },
];

/**
 * Long lists render in pages so a phone doesn't draw 900 cards at once.
 * Past, Cancelled and All are read a page at a time too: there's no end to
 * those.
 */
const PAGE = 100;

/** Going ahead, or still being paid for. */
const ON: Array<BookingDoc['status']> = ['confirmed', 'pending-payment'];
/** Over, and not cancelled. */
const DONE: Array<BookingDoc['status']> = ['completed', 'no-show'];

/**
 * The tabs other than Upcoming, as Firestore reads them, latest tour date
 * first: these statuses (any, if left out), with a tour date before
 * `before`. Past is everything not cancelled from before today, plus the
 * trips marked completed or no-show today (see {@link firstPage}).
 * Upcoming is every confirmed or unpaid booking from today on.
 */
const OLDER: Record<OlderTab, { statuses?: Array<BookingDoc['status']>; before: (today: string) => string | null }> = {
  past: { statuses: [...ON, ...DONE], before: (today) => today },
  cancelled: { statuses: ['cancelled'], before: () => null },
  all: { before: () => null },
};

/** A tab's bookings so far, and where its next page starts (null: they're all here). */
interface Loaded {
  rows: BookingDoc[];
  next: string | null;
}

async function firstPage(tab: Tab, today: string): Promise<Loaded> {
  if (tab === 'upcoming') return { rows: await listBookingsFrom(today, ON), next: null };
  const page = listBookingsPage({ statuses: OLDER[tab].statuses, before: OLDER[tab].before(today), pageSize: PAGE });
  // Marked completed or a no-show today (or a later date): the newest of Past.
  const [marked, { bookings, next }] = await Promise.all([tab === 'past' ? listBookingsFrom(today, DONE) : [], page]);
  return { rows: [...marked, ...bookings], next };
}

async function tabCounts(today: string): Promise<Record<OlderTab, number>> {
  const [pastBefore, pastMarked, cancelled, all] = await Promise.all([
    countBookings({ statuses: OLDER.past.statuses, before: today }),
    countBookings({ statuses: DONE, from: today }),
    countBookings({ statuses: OLDER.cancelled.statuses }),
    countBookings({}),
  ]);
  return { past: pastBefore + pastMarked, cancelled, all };
}

/** What search looks at: in a booking, or in a {@link BookingSearchRow}. */
type Searchable = Pick<
  BookingDoc,
  'id' | 'date' | 'timeSlot' | 'customerName' | 'customerEmail' | 'customerPhone' | 'tourName'
> & { legacy?: Pick<LegacyBookingInfo, 'bookingId'> };

function fromSearchRow([id, date, timeSlot, customerName, customerEmail, customerPhone, tourName, oldId]: BookingSearchRow): Searchable {
  return {
    id,
    date,
    timeSlot,
    customerName,
    customerEmail,
    customerPhone,
    tourName,
    ...(oldId !== null && { legacy: { bookingId: oldId } }),
  };
}

/** Every booking's search fields are fetched again for a search started this long after. */
const SEARCH_ROWS_FRESH_MS = 5 * 60_000;

/**
 * Kept from one visit to the page to the next, until a reload: opening a
 * booking and coming back to search again needn't read every booking again.
 */
let lastSearchRows: { rows: Searchable[]; at: number } | null = null;

/**
 * By tour date and departure time, soonest first or latest first. Each
 * booking's time is worked out once: a search can sort thousands, and the
 * sunset cruise's needs the sun.
 */
function byTourTime<T extends Pick<BookingDoc, 'date' | 'timeSlot'>>(list: T[], latestFirst = false): T[] {
  const keyed = list.map((b) => ({ b, minutes: departureMinutes(b) }));
  keyed.sort((x, y) => x.b.date.localeCompare(y.b.date) || x.minutes - y.minutes);
  if (latestFirst) keyed.reverse();
  return keyed.map((k) => k.b);
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

function matches(b: Searchable, q: string): boolean {
  const digits = q.replace(/\D/g, '');
  if (digits.length >= 3 && b.customerPhone.replace(/\D/g, '').includes(digits)) return true;
  if (digits && b.legacy && String(b.legacy.bookingId) === digits) return true;
  const haystack = `${b.customerName} ${b.customerEmail} ${b.tourName} ${b.date}`.toLowerCase();
  return haystack.includes(q.toLowerCase());
}

const LOAD_ERROR = 'Couldn’t load bookings. Check your signal and pull down to refresh.';

export function BookingsList() {
  const [loaded, setLoaded] = useState<Partial<Record<Tab, Loaded>>>({});
  const [counts, setCounts] = useState<Partial<Record<OlderTab, number>>>({});
  const [tab, setTab] = useState<Tab>('upcoming');
  const [search, setSearch] = useState('');
  const [shown, setShown] = useState(PAGE);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Every booking's search fields (bookingSearchRows), once a search starts.
  const [searchRows, setSearchRows] = useState(() => lastSearchRows);
  const [searchRowsError, setSearchRowsError] = useState<string | null>(null);
  // Search results not in any tab loaded so far, read by id; and any that
  // turned out not to exist any more.
  const [found, setFound] = useState<Map<string, BookingDoc>>(() => new Map());
  const [gone, setGone] = useState<Set<string>>(() => new Set());
  const loadingTabs = useRef(new Set<Tab>());
  const loadingSearchRows = useRef(false);
  const askedFor = useRef(new Set<string>());

  const today = marinaNow().date;
  const q = search.trim();

  useEffect(() => {
    if (loaded[tab] || loadingTabs.current.has(tab)) return;
    loadingTabs.current.add(tab);
    firstPage(tab, today)
      .then((page) => setLoaded((l) => ({ ...l, [tab]: page })))
      .catch(() => setError(LOAD_ERROR))
      .finally(() => loadingTabs.current.delete(tab));
  }, [tab, loaded, today]);

  useEffect(() => {
    // Only the numbers on the tabs: without them the tabs still work.
    tabCounts(today).then(setCounts).catch(() => {});
  }, [today]);

  /** A new search: fetch every booking's search fields, unless they're fresh. */
  function startSearch() {
    if (loadingSearchRows.current) return;
    if (searchRows && Date.now() - searchRows.at < SEARCH_ROWS_FRESH_MS) return;
    loadingSearchRows.current = true;
    setSearchRowsError(null);
    bookingSearchRows()
      .then((res) => {
        if (!res.ok) {
          setSearchRowsError(res.error);
          return;
        }
        lastSearchRows = { rows: res.rows.map(fromSearchRow), at: Date.now() };
        setSearchRows(lastSearchRows);
      })
      .catch(() => setSearchRowsError('Couldn’t search every booking just now.'))
      .finally(() => {
        loadingSearchRows.current = false;
      });
  }

  // Every booking this page has read in full: the tabs' and search results'.
  const known = useMemo(() => {
    const all = new Map(found);
    for (const page of Object.values(loaded)) for (const b of page.rows) all.set(b.id, b);
    return all;
  }, [loaded, found]);

  // A search looks through every booking, whichever tab is open: every
  // booking's search fields, and the bookings this page has read in full,
  // which are as new or newer, so they win. Until the search fields are
  // here, just the ones this page has read.
  const matched = useMemo(() => {
    if (!q) return null;
    const pool = new Map<string, Searchable>((searchRows?.rows ?? []).map((r) => [r.id, r]));
    for (const b of known.values()) pool.set(b.id, b);
    return byTourTime([...pool.values()].filter((b) => !gone.has(b.id) && matches(b, q)), true);
  }, [q, known, searchRows, gone]);

  // Read the search results on screen that no tab has loaded.
  useEffect(() => {
    if (!matched) return;
    const missing = matched
      .slice(0, shown)
      .map((b) => b.id)
      .filter((id) => !known.has(id) && !askedFor.current.has(id));
    if (missing.length === 0) return;
    // Not on every keystroke: once the search has settled.
    const timer = setTimeout(() => {
      missing.forEach((id) => askedFor.current.add(id));
      listBookingsById(missing)
        .then((docs) => {
          setFound((f) => {
            const next = new Map(f);
            for (const b of docs) next.set(b.id, b);
            return next;
          });
          const read = new Set(docs.map((b) => b.id));
          if (read.size < missing.length) setGone((g) => new Set([...g, ...missing.filter((id) => !read.has(id))]));
        })
        .catch(() => {
          missing.forEach((id) => askedFor.current.delete(id));
          setError(LOAD_ERROR);
        });
    }, 300);
    return () => clearTimeout(timer);
  }, [matched, shown, known]);

  async function loadMore(t: OlderTab, before: string) {
    setLoadingMore(true);
    try {
      const page = await listBookingsPage({ statuses: OLDER[t].statuses, before, pageSize: PAGE });
      setLoaded((l) => ({ ...l, [t]: { rows: [...(l[t]?.rows ?? []), ...page.bookings], next: page.next } }));
    } catch {
      setError(LOAD_ERROR);
    } finally {
      setLoadingMore(false);
    }
  }

  const current = loaded[tab];
  let list: BookingDoc[] | null;
  let total: number | undefined;
  let more: { left: number | undefined; onClick: () => void } | null = null;
  if (matched) {
    // Bookings still being read drop in as they arrive.
    const onScreen = matched.slice(0, shown).flatMap((b) => known.get(b.id) ?? []);
    list = byTourTime(onScreen, true);
    total = matched.length;
    if (matched.length > shown) more = { left: matched.length - shown, onClick: () => setShown((n) => n + PAGE) };
  } else if (!current) {
    list = null;
  } else if (tab === 'upcoming') {
    // Upcoming reads soonest first; everything else, latest first.
    const all = byTourTime(current.rows);
    list = all.slice(0, shown);
    total = all.length;
    if (all.length > shown) more = { left: all.length - shown, onClick: () => setShown((n) => n + PAGE) };
  } else {
    list = byTourTime(current.rows, true);
    total = counts[tab];
    const { next } = current;
    const t = tab;
    if (next && (total === undefined || total > list.length)) {
      more = { left: total === undefined ? undefined : total - list.length, onClick: () => void loadMore(t, next) };
    }
  }
  const searching = !!matched && !searchRows && !searchRowsError;
  const readingResults = !!matched && !error && list !== null && list.length < Math.min(matched.length, shown);

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
            onChange={(e) => {
              if (!q && e.target.value.trim()) startSearch();
              setSearch(e.target.value);
              setShown(PAGE);
            }}
            className={clsx(inputClass, 'pl-10')}
          />
        </label>

        {!q && (
          <FilterTabs
            label="Show bookings"
            options={TABS.map((t) => ({
              ...t,
              count: t.value === 'upcoming' ? loaded.upcoming?.rows.length : counts[t.value],
            }))}
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

      {q && (searching || searchRowsError) && (
        <p role="status" className="text-sm text-[var(--color-ink-soft)]">
          {searching ? 'Searching every booking…' : `${searchRowsError} These are only the ones this page has loaded.`}
        </p>
      )}

      {(list === null && !error) || (readingResults && list?.length === 0) ? (
        <p className={clsx(panelClass, 'p-8 text-center text-sm text-[var(--color-ink-soft)] animate-pulse')}>
          Loading bookings…
        </p>
      ) : !list || list.length === 0 ? (
        !searching && (
          <p className="rounded-2xl border border-dashed border-[var(--color-line-strong)] bg-white/50 p-8 text-center text-sm text-[var(--color-ink-soft)]">
            {q ? 'No bookings match that search.' : tab === 'upcoming' ? 'No upcoming bookings.' : 'Nothing here.'}
          </p>
        )
      ) : (
        <>
          {q && !searching && (
            <p className="text-sm font-medium text-[var(--color-ink-soft)]">
              {total} booking{total === 1 ? '' : 's'} found
            </p>
          )}
          {byDay(list).map(({ date, bookings }) => {
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
                        <TimeTile time={departureTime(b)} size="sm" muted={b.status === 'cancelled'} spoken />
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
          {readingResults && (
            <p className="text-center text-sm text-[var(--color-ink-soft)] animate-pulse">Loading bookings…</p>
          )}
          {more && (
            <button
              type="button"
              onClick={more.onClick}
              disabled={loadingMore}
              className={clsx(buttonClass('secondary'), 'w-full')}
            >
              {loadingMore ? 'Loading…' : more.left !== undefined ? `Show more (${more.left} left)` : 'Show more'}
            </button>
          )}
        </>
      )}
    </div>
  );
}

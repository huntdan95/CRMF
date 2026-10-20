'use client';

import { useEffect, useMemo, useState } from 'react';
import { admin } from '@/lib/admin-client';
import { FunctionError } from '@/lib/functions-client';
import { listAllTours, listRateSeasons, type RateSeasonDoc } from '@/lib/admin-firestore';
import { marinaNow } from '@/lib/availability';
import { bigPriceChange, formatSeasonDates, priceChangeWords, standardUnitPrice } from '@/lib/pricing';
import { formatPrice, getTourBySlug, slotLabels, slotOrder, type TourTimeSlot } from '@/lib/tours';
import { clsx } from '@/lib/clsx';
import {
  Badge,
  PanelBody,
  PanelFooter,
  PanelHeader,
  buttonClass,
  hintClass,
  inputClass,
  labelClass,
  panelClass,
} from './ui';

type TourRow = Awaited<ReturnType<typeof listAllTours>>[number];

interface Draft {
  /** Set when editing an existing season. */
  id?: string;
  /**
   * Editing: the season's `updatedAt` as it was loaded. The function turns
   * the save down if it has changed since (from MCP or another tab), since
   * saving would put the old prices back.
   */
  loadedUpdatedAt?: { seconds: number; nanoseconds: number } | null;
  /** The prices it started from (the season edited or reused), in cents, to catch a typo against. */
  startPrices: Record<string, number>;
  name: string;
  startDate: string;
  endDate: string;
  /** Dollars as typed, keyed by tour slug. Empty = standard price. */
  prices: Record<string, string>;
}

const emptyDraft = (): Draft => ({ startPrices: {}, name: '', startDate: '', endDate: '', prices: {} });

function toDollars(cents: number): string {
  return (cents / 100).toString();
}

function nextYear(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  // Feb 29 → Feb 28 in a non-leap year.
  const date = new Date(Date.UTC(y! + 1, m! - 1, d!));
  if (date.getUTCMonth() !== m! - 1) date.setUTCDate(0);
  return date.toISOString().slice(0, 10);
}

/** Rows of the price grid: one per departure time, shared and private side by side. */
function gridRows(tours: TourRow[]) {
  const find = (slot: TourTimeSlot, type: 'shared' | 'private') =>
    tours.find((t) => t.timeSlot === slot && t.type === type);
  return [
    ...slotOrder.map((slot) => ({ slot, shared: find(slot, 'shared'), private: find(slot, 'private') })),
    { slot: 'whole-day' as const, shared: undefined, private: find('whole-day', 'private') },
    { slot: 'sunset' as const, shared: undefined, private: find('sunset', 'private') },
  ];
}

function timeLabel(slot: TourTimeSlot, slug: string | undefined): string {
  const t = slug ? getTourBySlug(slug) : undefined;
  if (slot === 'whole-day') return `Whole day${t ? ` · ${t.startTimeDisplay}` : ''}`;
  if (slot === 'sunset') return 'Sunset cruise';
  return t ? t.startTimeDisplay : slotLabels[slot];
}

/** "Shared $94 · Private $550 · Whole day $995", with ranges where departures differ. */
function summarize(season: RateSeasonDoc, tours: TourRow[]): string {
  const group = (label: string, list: TourRow[]) => {
    const prices = list.map((t) => season.prices[t.slug]).filter((p): p is number => p != null);
    if (prices.length === 0) return null;
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const amount = min === max ? formatPrice(min) : `${formatPrice(min)}–${formatPrice(max)}`;
    return `${label} ${amount}${prices.length < list.length ? ' (some times)' : ''}`;
  };
  return (
    [
      group('Shared', tours.filter((t) => t.type === 'shared')),
      group('Private', tours.filter((t) => t.type === 'private' && t.timeSlot !== 'whole-day' && t.timeSlot !== 'sunset')),
      group('Whole day', tours.filter((t) => t.timeSlot === 'whole-day')),
      group('Sunset cruise', tours.filter((t) => t.timeSlot === 'sunset')),
    ]
      .filter(Boolean)
      .join(' · ') || 'No prices set'
  );
}

export function RateSeasonsAdmin() {
  const [tours, setTours] = useState<TourRow[] | null>(null);
  const [seasons, setSeasons] = useState<RateSeasonDoc[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  // The "fill all" boxes above each price column.
  const [fill, setFill] = useState({ shared: '', private: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const today = marinaNow().date;

  function refresh() {
    return Promise.all([listAllTours(), listRateSeasons()]).then(
      ([t, s]) => {
        setTours(t);
        setSeasons(s);
      },
      (err: unknown) => setError(err instanceof Error ? err.message : 'Couldn’t load seasonal rates.'),
    );
  }

  useEffect(() => {
    refresh();
  }, []);

  const upcoming = (seasons ?? []).filter((s) => s.endDate >= today);
  const past = (seasons ?? []).filter((s) => s.endDate < today).reverse();

  const overlaps = useMemo(() => {
    if (!draft?.startDate || !draft.endDate || !seasons) return [];
    return seasons.filter(
      (s) => s.id !== draft.id && s.startDate <= draft.endDate && draft.startDate <= s.endDate,
    );
  }, [draft, seasons]);

  function startNew() {
    setFlash(null);
    setError(null);
    setFill({ shared: '', private: '' });
    setDraft(emptyDraft());
  }

  function startEdit(s: RateSeasonDoc, reuse = false) {
    setFlash(null);
    setError(null);
    setFill({ shared: '', private: '' });
    setDraft({
      id: reuse ? undefined : s.id,
      loadedUpdatedAt: reuse
        ? undefined
        : s.updatedAt
          ? { seconds: s.updatedAt.seconds, nanoseconds: s.updatedAt.nanoseconds }
          : null,
      startPrices: s.prices,
      name: s.name,
      startDate: reuse ? nextYear(s.startDate) : s.startDate,
      endDate: reuse ? nextYear(s.endDate) : s.endDate,
      prices: Object.fromEntries(Object.entries(s.prices).map(([slug, c]) => [slug, toDollars(c)])),
    });
    document.getElementById('seasonal-rates')?.scrollIntoView({ behavior: 'smooth' });
  }

  function setPrice(slug: string, value: string) {
    setDraft((d) => (d ? { ...d, prices: { ...d.prices, [slug]: value } } : d));
  }

  function fillColumn(list: Array<TourRow | undefined>, value: string) {
    setDraft((d) => {
      if (!d) return d;
      const prices = { ...d.prices };
      for (const t of list) if (t) prices[t.slug] = value;
      return { ...d, prices };
    });
  }

  async function save() {
    if (!draft) return;
    setError(null);
    const name = draft.name.trim();
    if (!name) return setError('Give the season a name, like “Peak season” or “July 4th”.');
    if (!draft.startDate || !draft.endDate) return setError('Pick the first and last day.');
    if (draft.endDate < draft.startDate) return setError('The last day can’t be before the first day.');
    const prices: Record<string, number> = {};
    for (const [slug, raw] of Object.entries(draft.prices)) {
      if (raw.trim() === '') continue;
      const cents = Math.round(Number.parseFloat(raw) * 100);
      if (!Number.isFinite(cents) || cents < 50) {
        return setError(`Check the price for ${getTourBySlug(slug)?.name ?? slug}: it needs to be at least $0.50.`);
      }
      // adminUpsertRateSeason's ceiling.
      if (cents > 10_000_000) {
        return setError(`Check the price for ${getTourBySlug(slug)?.name ?? slug}: it can be at most $100,000.`);
      }
      prices[slug] = cents;
    }
    if (Object.keys(prices).length === 0) return setError('Set a price for at least one tour.');

    // A slipped decimal point is charged on the next booking: ask first
    // about any price more than half again, or less than half, what it was
    // (the season's own price, or the standard one).
    const typos = Object.entries(prices).flatMap(([slug, cents]) => {
      const tour = tours?.find((t) => t.slug === slug);
      const was = draft.startPrices[slug] ?? (tour ? standardUnitPrice(tour) : null);
      if (was == null || !bigPriceChange(was, cents)) return [];
      return [`${tour?.name ?? slug}: ${formatPrice(was)} → ${formatPrice(cents)} (${priceChangeWords(was, cents)})`];
    });
    if (typos.length > 0 && !confirm(`Check these prices for a typo:\n\n${typos.join('\n')}\n\nSave them?`)) return;

    setBusy(true);
    try {
      await admin.upsertRateSeason({
        id: draft.id,
        name,
        startDate: draft.startDate,
        endDate: draft.endDate,
        prices,
        ...(draft.id && { expectedUpdatedAt: draft.loadedUpdatedAt ?? null }),
      });
      setFlash(`Saved “${name}”. It’s on the website now, or within a minute at most.`);
      setDraft(null);
      await refresh();
    } catch (err) {
      setError(err instanceof FunctionError || err instanceof Error ? err.message : 'Couldn’t save.');
      // Changed since it was opened: load it as it is now, for Edit to start from.
      if (err instanceof FunctionError && err.status === 409) await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function remove(s: RateSeasonDoc) {
    if (!confirm(`Delete “${s.name}”? Those dates go back to standard prices. Bookings already made keep what they paid.`)) {
      return;
    }
    setError(null);
    try {
      await admin.deleteRateSeason(s.id);
      setFlash(`Deleted “${s.name}”.`);
      if (draft?.id === s.id) setDraft(null);
      await refresh();
    } catch (err) {
      setError(err instanceof FunctionError || err instanceof Error ? err.message : 'Couldn’t delete.');
    }
  }

  if (tours === null || seasons === null) {
    return (
      <div className={clsx(panelClass, 'p-6 text-center text-sm text-[var(--color-ink-soft)] animate-pulse')}>
        {error ?? 'Loading seasonal rates…'}
      </div>
    );
  }

  const rows = gridRows(tours);

  return (
    <div className="space-y-4">
      {flash && (
        <div className="rounded-2xl bg-[var(--color-brand-blue)]/10 border border-[var(--color-brand-blue)]/20 p-3 text-sm">
          {flash}
        </div>
      )}
      {error && !draft && (
        <div className="rounded-2xl bg-[var(--color-coral)]/10 border border-[var(--color-coral)]/30 p-3 text-sm">
          {error}
        </div>
      )}

      {draft ? (
        <section className={clsx(panelClass, 'overflow-hidden')}>
          <PanelHeader as="h3" title={draft.id ? `Edit “${draft.name || 'season'}”` : 'New seasonal rates'} />
          <PanelBody>
            <div className="grid gap-x-4 gap-y-5 sm:grid-cols-3">
              <label className="block sm:col-span-3">
                <span className={labelClass}>Name</span>
                <input
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  maxLength={80}
                  placeholder="Peak season, Christmas week, July 4th…"
                  className={inputClass}
                />
                <span className={hintClass}>
                  Guests see this next to the price, e.g. “Peak season rate”.
                </span>
              </label>
              <label className="block">
                <span className={labelClass}>First day</span>
                <input
                  type="date"
                  value={draft.startDate}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      startDate: e.target.value,
                      endDate: draft.endDate && draft.endDate >= e.target.value ? draft.endDate : e.target.value,
                    })
                  }
                  className={inputClass}
                />
              </label>
              <label className="block">
                <span className={labelClass}>Last day</span>
                <input
                  type="date"
                  value={draft.endDate}
                  min={draft.startDate || undefined}
                  onChange={(e) => setDraft({ ...draft, endDate: e.target.value })}
                  className={inputClass}
                />
              </label>
              <p className="self-end pb-3 text-xs text-[var(--color-ink-soft)]">
                For a single day, make the first and last day the same.
              </p>
            </div>

            {overlaps.length > 0 && (
              <p className="mt-4 rounded-xl border border-[var(--color-line)] bg-[var(--color-sand)]/50 px-3 py-2 text-sm">
                Overlaps {overlaps.map((s) => `${s.name} (${formatSeasonDates(s, today)})`).join(', ')}. Where
                they overlap, the shorter date range&rsquo;s prices win, so a holiday can sit inside a season.
              </p>
            )}

            <div className="mt-6 overflow-x-auto rounded-xl border border-[var(--color-line)]">
              <table className="w-full text-sm">
                <thead className="bg-[var(--color-paper)] text-[var(--color-ink-soft)]">
                  <tr>
                    <th className="px-3 py-2.5 text-left text-label">Departs</th>
                    <th className="px-3 py-2.5 text-left text-label">Shared, per seat</th>
                    <th className="px-3 py-2.5 text-left text-label">Private, whole boat</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t border-[var(--color-line)] bg-[var(--color-mist)]/50">
                    <th scope="row" className="px-3 py-2 text-left font-medium">All 2-hour times</th>
                    <td className="px-3 py-2">
                      <PriceInput
                        value={fill.shared}
                        placeholder="Fill all"
                        label="Shared price for every time"
                        onChange={(v) => {
                          setFill((f) => ({ ...f, shared: v }));
                          fillColumn(rows.map((r) => r.shared), v);
                        }}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <PriceInput
                        value={fill.private}
                        placeholder="Fill all"
                        label="Private price for every 2-hour time"
                        onChange={(v) => {
                          setFill((f) => ({ ...f, private: v }));
                          fillColumn(rows.filter((r) => r.slot !== 'whole-day' && r.slot !== 'sunset').map((r) => r.private), v);
                        }}
                      />
                    </td>
                  </tr>
                  {rows.map((r) => (
                    <tr key={r.slot} className="border-t border-[var(--color-line)]">
                      <th scope="row" className="px-3 py-2 text-left font-medium tabular-nums whitespace-nowrap">
                        {timeLabel(r.slot, (r.shared ?? r.private)?.slug)}
                      </th>
                      {(['shared', 'private'] as const).map((kind) => {
                        const t = r[kind];
                        if (!t) {
                          return (
                            <td key={kind} className="px-3 py-2 text-xs text-[var(--color-ink-soft)]">
                              {r.slot === 'whole-day' || r.slot === 'sunset' ? 'Private only' : '—'}
                            </td>
                          );
                        }
                        return (
                          <td key={kind} className="px-3 py-2">
                            <PriceInput
                              value={draft.prices[t.slug] ?? ''}
                              placeholder={toDollars(standardUnitPrice(t))}
                              label={`${t.name} price`}
                              onChange={(v) => setPrice(t.slug, v)}
                            />
                            {!t.active && (
                              <span className="block text-xs text-[var(--color-ink-soft)] mt-0.5">Not taking bookings</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-[var(--color-ink-soft)]">
              Leave a box empty to keep the standard price (shown in grey). New prices apply to
              bookings made after you save; people who already booked keep what they paid.
            </p>

            {error && (
              <div className="mt-4 rounded-2xl bg-[var(--color-coral)]/10 border border-[var(--color-coral)]/30 p-3 text-sm">
                {error}
              </div>
            )}
          </PanelBody>

          <PanelFooter>
            <button
              type="button"
              onClick={() => {
                setDraft(null);
                setError(null);
              }}
              className={buttonClass('secondary')}
            >
              Cancel
            </button>
            <button type="button" onClick={save} disabled={busy} className={buttonClass('primary')}>
              {busy ? 'Saving…' : 'Save seasonal rates'}
            </button>
          </PanelFooter>
        </section>
      ) : (
        <button type="button" onClick={startNew} className={clsx(buttonClass('primary'), 'w-full sm:w-auto')}>
          Add seasonal or holiday rates
        </button>
      )}

      <section className={clsx(panelClass, 'overflow-hidden')}>
        <PanelHeader
          as="h3"
          title="Coming up"
          aside={upcoming.length > 0 && <Badge>{upcoming.length}</Badge>}
        />
        {upcoming.length === 0 ? (
          <p className="p-5 text-sm text-[var(--color-ink-soft)]">
            No seasonal rates coming up. Every date uses the standard prices above.
          </p>
        ) : (
          <ul className="divide-y divide-[var(--color-line)]">
            {upcoming.map((s) => (
              <SeasonRow
                key={s.id}
                season={s}
                summary={summarize(s, tours)}
                dates={formatSeasonDates(s, today)}
                onNow={s.startDate <= today}
                onEdit={() => startEdit(s)}
                onReuse={() => startEdit(s, true)}
                onDelete={() => remove(s)}
              />
            ))}
          </ul>
        )}
      </section>

      {past.length > 0 && (
        <details className={clsx(panelClass, 'overflow-hidden group')}>
          <summary className="flex min-h-12 cursor-pointer items-center justify-between gap-3 px-5 text-sm font-semibold hover:bg-[var(--color-paper)]/70">
            Past seasons ({past.length})
            <span aria-hidden className="text-[var(--color-ink-soft)] transition-transform group-open:rotate-180">▾</span>
          </summary>
          <ul className="divide-y divide-[var(--color-line)] border-t border-[var(--color-line)]">
            {past.map((s) => (
              <SeasonRow
                key={s.id}
                season={s}
                summary={summarize(s, tours)}
                dates={formatSeasonDates(s, today)}
                onNow={false}
                past
                onEdit={() => startEdit(s)}
                onReuse={() => startEdit(s, true)}
                onDelete={() => remove(s)}
              />
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function SeasonRow({
  season,
  summary,
  dates,
  onNow,
  past = false,
  onEdit,
  onReuse,
  onDelete,
}: {
  season: RateSeasonDoc;
  summary: string;
  dates: string;
  onNow: boolean;
  past?: boolean;
  onEdit: () => void;
  onReuse: () => void;
  onDelete: () => void;
}) {
  return (
    <li className={clsx('px-5 py-4', past && 'text-[var(--color-ink-soft)]')}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <p className="flex flex-wrap items-center gap-2 font-semibold text-[var(--color-ink)]">
          {season.name}
          {onNow && <Badge tone="spring">On now</Badge>}
        </p>
        <p className="text-sm font-medium tabular-nums">{dates}</p>
      </div>
      <p className="mt-1 text-sm text-[var(--color-ink-soft)]">{summary}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {!past && (
          <button type="button" onClick={onEdit} className={buttonClass('secondary', 'sm')}>
            Edit
          </button>
        )}
        <button type="button" onClick={onReuse} className={buttonClass('secondary', 'sm')}>
          Reuse next year
        </button>
        <button type="button" onClick={onDelete} className={buttonClass('danger', 'sm')}>
          Delete
        </button>
      </div>
    </li>
  );
}

function PriceInput({
  value,
  placeholder,
  label,
  onChange,
}: {
  value: string;
  placeholder: string;
  label: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="relative max-w-[9rem]">
      <span aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-ink-soft)]">
        $
      </span>
      <input
        type="number"
        inputMode="decimal"
        step="0.01"
        min="0"
        value={value}
        placeholder={placeholder}
        aria-label={label}
        onChange={(e) => onChange(e.target.value)}
        className={`${inputClass} pl-7 tabular-nums`}
      />
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { admin } from '@/lib/admin-client';
import { FunctionError } from '@/lib/functions-client';
import { listAllTours } from '@/lib/admin-firestore';
import { formatPrice, getTourBySlug } from '@/lib/tours';
import { boatLabel } from '@/lib/experience';
import { clsx } from '@/lib/clsx';

interface TourRow {
  id: string;
  slug: string;
  name: string;
  description: string;
  pricePerPerson: number | null;
  flatPrice: number | null;
  active: boolean;
  included: string[];
  timeSlot: string;
  startTime: string;
  durationHours: number;
  type: 'shared' | 'private';
}

interface Draft {
  name: string;
  description: string;
  pricePerPersonDollars: string;
  flatPriceDollars: string;
  active: boolean;
  included: string;
}

const inputClass =
  'w-full rounded-xl border border-[var(--color-ink)]/15 bg-white px-3 py-2 text-base focus:border-[var(--color-brand-blue)] focus:outline-2 focus:outline-[var(--color-brand-blue)]/20';

/** "8:00 AM – 10:00 AM · Shared boat", from the built-in schedule. */
function scheduleLine(t: TourRow): string {
  const built = getTourBySlug(t.slug);
  if (!built) return t.startTime;
  return `${built.startTimeDisplay} – ${built.endTimeDisplay} · ${boatLabel(built)}`;
}

async function loadTours(): Promise<TourRow[]> {
  const list = (await listAllTours()) as TourRow[];
  return list.sort((a, b) => a.startTime.localeCompare(b.startTime) || a.type.localeCompare(b.type));
}

function sameDraft(a: Draft, b: Draft): boolean {
  return (Object.keys(a) as Array<keyof Draft>).every((k) => a[k] === b[k]);
}

export function ToursAdmin() {
  const [tours, setTours] = useState<TourRow[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ slug: string; kind: 'ok' | 'err'; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** Resets only `slug`'s draft (or all, on first load), so other cards keep their unsaved edits. */
  function apply(list: TourRow[], slug?: string) {
    setTours(list);
    setDrafts((prev) =>
      Object.fromEntries(
        list.map((t) => [t.slug, slug === undefined || t.slug === slug || !prev[t.slug] ? toDraft(t) : prev[t.slug]!]),
      ),
    );
  }

  const loadFailed = (err: unknown) => setError(err instanceof Error ? err.message : 'Couldn’t load the tours.');

  async function refresh(slug: string) {
    setError(null);
    try {
      apply(await loadTours(), slug);
    } catch (err) {
      loadFailed(err);
    }
  }

  useEffect(() => {
    loadTours().then((list) => apply(list), loadFailed);
  }, []);

  function edit(slug: string, patch: Partial<Draft>) {
    setDrafts((prev) => ({ ...prev, [slug]: { ...prev[slug]!, ...patch } }));
  }

  async function save(t: TourRow) {
    const d = drafts[t.slug]!;
    setBusy(t.slug);
    setFlash(null);
    try {
      const toCents = (s: string) => (s.trim() === '' ? null : Math.round(Number.parseFloat(s) * 100));
      const pricePerPerson = toCents(d.pricePerPersonDollars);
      const flatPrice = toCents(d.flatPriceDollars);

      if (t.type === 'shared' && (pricePerPerson == null || Number.isNaN(pricePerPerson))) {
        throw new Error('Enter a price per person.');
      }
      if (t.type === 'private' && (flatPrice == null || Number.isNaN(flatPrice))) {
        throw new Error('Enter a price for the boat.');
      }
      if (!d.name.trim()) throw new Error('The tour needs a name.');
      if (!d.description.trim()) throw new Error('The tour needs a description.');

      const included = d.included
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);

      await admin.updateTour(t.slug, {
        name: d.name.trim(),
        description: d.description.trim(),
        pricePerPerson,
        flatPrice,
        active: d.active,
        included,
      });
      setFlash({ slug: t.slug, kind: 'ok', message: 'Saved. The website shows it within a minute.' });
      await refresh(t.slug);
    } catch (err) {
      setFlash({
        slug: t.slug,
        kind: 'err',
        message:
          err instanceof FunctionError
            ? err.message
            : err instanceof Error
              ? err.message
              : 'Couldn’t save.',
      });
    } finally {
      setBusy(null);
    }
  }

  if (tours === null) {
    return (
      <div className="rounded-2xl bg-white border border-[var(--color-ink)]/8 p-6 text-center text-sm text-[var(--color-ink-soft)] animate-pulse">
        {error ?? 'Loading tours…'}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-2xl bg-[var(--color-coral)]/10 border border-[var(--color-coral)]/30 p-3 text-sm">
          {error}
        </div>
      )}
      {tours.length === 0 && (
        <div className="rounded-2xl bg-[var(--color-cream)] border border-[var(--color-ink)]/8 p-5 text-sm">
          No tours found yet. Your developer needs to load the tour list once; after that
          you can edit everything here.
        </div>
      )}
      {tours.map((t) => {
        const d = drafts[t.slug];
        if (!d) return null;
        const myFlash = flash?.slug === t.slug ? flash : null;
        const dirty = !sameDraft(d, toDraft(t));
        return (
          <section
            key={t.slug}
            className={clsx(
              'bg-white rounded-2xl border border-[var(--color-ink)]/8 shadow-[var(--shadow-card)] p-5',
              !d.active && 'bg-[var(--color-cream)]/60',
            )}
          >
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <h2 className="font-display text-lg">{t.name}</h2>
                <p className="text-sm text-[var(--color-ink-soft)] mt-0.5">{scheduleLine(t)}</p>
              </div>
              <label className="flex items-center gap-2 text-base">
                <input
                  type="checkbox"
                  checked={d.active}
                  onChange={(e) => edit(t.slug, { active: e.target.checked })}
                  className="w-5 h-5"
                />
                Taking bookings
              </label>
            </div>
            {!d.active && (
              <p className="mt-2 text-sm text-[var(--color-ink-soft)]">
                Off: hidden from the booking page and nobody can book it. Its page on the
                website says it isn&rsquo;t running.
              </p>
            )}

            <div className="mt-4 grid sm:grid-cols-2 gap-3">
              <label className="block">
                <span className="block text-sm font-medium mb-1">Name</span>
                <input value={d.name} onChange={(e) => edit(t.slug, { name: e.target.value })} className={inputClass} />
                <span className="block text-xs text-[var(--color-ink-soft)] mt-1">
                  Shows on receipts, confirmation emails and Google search results.
                </span>
              </label>
              {t.type === 'shared' ? (
                <label className="block">
                  <span className="block text-sm font-medium mb-1">Standard price per person ($)</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    value={d.pricePerPersonDollars}
                    onChange={(e) => edit(t.slug, { pricePerPersonDollars: e.target.value })}
                    className={inputClass}
                  />
                  <span className="block text-xs text-[var(--color-ink-soft)] mt-1">
                    Now {t.pricePerPerson != null ? formatPrice(t.pricePerPerson) : '—'} a seat. Seasonal rates below
                    override it on their dates.
                  </span>
                </label>
              ) : (
                <label className="block">
                  <span className="block text-sm font-medium mb-1">Standard price for the boat ($)</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    value={d.flatPriceDollars}
                    onChange={(e) => edit(t.slug, { flatPriceDollars: e.target.value })}
                    className={inputClass}
                  />
                  <span className="block text-xs text-[var(--color-ink-soft)] mt-1">
                    Now {t.flatPrice != null ? formatPrice(t.flatPrice) : '—'}. Seasonal rates below override it on
                    their dates.
                  </span>
                </label>
              )}
            </div>

            <label className="block mt-3">
              <span className="block text-sm font-medium mb-1">Description</span>
              <textarea
                value={d.description}
                onChange={(e) => edit(t.slug, { description: e.target.value })}
                rows={3}
                maxLength={4000}
                className={inputClass}
              />
            </label>

            <label className="block mt-3">
              <span className="block text-sm font-medium mb-1">What&rsquo;s included (one per line)</span>
              <textarea
                value={d.included}
                onChange={(e) => edit(t.slug, { included: e.target.value })}
                rows={5}
                className={inputClass}
              />
            </label>

            {myFlash && (
              <div
                className={clsx(
                  'mt-3 rounded-2xl px-3 py-2 text-sm border',
                  myFlash.kind === 'ok'
                    ? 'bg-[var(--color-brand-blue)]/10 border-[var(--color-brand-blue)]/20'
                    : 'bg-[var(--color-coral)]/10 border-[var(--color-coral)]/30',
                )}
              >
                {myFlash.message}
              </div>
            )}

            <div className="mt-4 flex items-center justify-end gap-3">
              {dirty && <span className="text-sm text-[var(--color-ink-soft)]">Unsaved changes</span>}
              <button
                type="button"
                onClick={() => save(t)}
                disabled={busy === t.slug}
                className="px-4 py-2.5 rounded-[10px] bg-[var(--color-brand-blue)] hover:bg-[var(--color-brand-blue-dark)] text-white text-base font-medium disabled:opacity-60"
              >
                {busy === t.slug ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </section>
        );
      })}
    </div>
  );
}

function toDraft(t: TourRow): Draft {
  return {
    name: t.name,
    description: t.description,
    pricePerPersonDollars:
      t.pricePerPerson != null ? (t.pricePerPerson / 100).toString() : '',
    flatPriceDollars: t.flatPrice != null ? (t.flatPrice / 100).toString() : '',
    active: t.active,
    included: t.included.join('\n'),
  };
}

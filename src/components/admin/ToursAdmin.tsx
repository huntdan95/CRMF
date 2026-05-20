'use client';

import { useEffect, useState } from 'react';
import { admin } from '@/lib/admin-client';
import { FunctionError } from '@/lib/functions-client';
import { listAllTours } from '@/lib/admin-firestore';
import { formatPrice } from '@/lib/tours';
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

export function ToursAdmin() {
  const [tours, setTours] = useState<TourRow[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ slug: string; kind: 'ok' | 'err'; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setError(null);
    try {
      const list = (await listAllTours()) as TourRow[];
      list.sort((a, b) => a.startTime.localeCompare(b.startTime) || a.type.localeCompare(b.type));
      setTours(list);
      setDrafts(Object.fromEntries(list.map((t) => [t.slug, toDraft(t)])));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tours.');
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function save(t: TourRow) {
    const d = drafts[t.slug]!;
    setBusy(t.slug);
    setFlash(null);
    try {
      const pricePerPerson = d.pricePerPersonDollars.trim() === ''
        ? null
        : Math.round(Number.parseFloat(d.pricePerPersonDollars) * 100);
      const flatPrice = d.flatPriceDollars.trim() === ''
        ? null
        : Math.round(Number.parseFloat(d.flatPriceDollars) * 100);

      if (t.type === 'shared' && (pricePerPerson == null || Number.isNaN(pricePerPerson))) {
        throw new Error('Shared tours need a per-person price.');
      }
      if (t.type === 'private' && (flatPrice == null || Number.isNaN(flatPrice))) {
        throw new Error('Private tours need a flat price.');
      }

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
      setFlash({ slug: t.slug, kind: 'ok', message: 'Saved.' });
      await refresh();
    } catch (err) {
      setFlash({
        slug: t.slug,
        kind: 'err',
        message:
          err instanceof FunctionError
            ? err.message
            : err instanceof Error
              ? err.message
              : 'Failed to save.',
      });
    } finally {
      setBusy(null);
    }
  }

  if (tours === null) {
    return (
      <div className="rounded-2xl bg-white border border-[var(--color-ink)]/8 p-6 text-center text-sm text-[var(--color-ink-soft)] animate-pulse">
        Loading tours…
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
          No tours in Firestore yet. Run <code className="font-mono bg-white px-1 rounded">npm run seed</code> against
          your project.
        </div>
      )}
      {tours.map((t) => {
        const d = drafts[t.slug];
        if (!d) return null;
        const myFlash = flash?.slug === t.slug ? flash : null;
        return (
          <section
            key={t.slug}
            className={clsx(
              'bg-white rounded-2xl border border-[var(--color-ink)]/8 shadow-[var(--shadow-card)] p-5',
              !t.active && 'opacity-90',
            )}
          >
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <h2 className="font-display text-lg">{t.name}</h2>
                <p className="text-xs text-[var(--color-ink-soft)] mt-0.5 font-mono">
                  {t.slug} · {t.startTime} · {t.type} · {t.durationHours}h
                </p>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={d.active}
                  onChange={(e) =>
                    setDrafts((prev) => ({
                      ...prev,
                      [t.slug]: { ...prev[t.slug]!, active: e.target.checked },
                    }))
                  }
                  className="w-4 h-4"
                />
                Active
              </label>
            </div>

            <div className="mt-4 grid sm:grid-cols-2 gap-3">
              <label className="block">
                <span className="block text-sm font-medium mb-1">Display name</span>
                <input
                  value={d.name}
                  onChange={(e) =>
                    setDrafts((prev) => ({
                      ...prev,
                      [t.slug]: { ...prev[t.slug]!, name: e.target.value },
                    }))
                  }
                  className={inputClass}
                />
              </label>
              {t.type === 'shared' ? (
                <label className="block">
                  <span className="block text-sm font-medium mb-1">Price per person (USD)</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    value={d.pricePerPersonDollars}
                    onChange={(e) =>
                      setDrafts((prev) => ({
                        ...prev,
                        [t.slug]: { ...prev[t.slug]!, pricePerPersonDollars: e.target.value },
                      }))
                    }
                    className={inputClass}
                  />
                  <p className="text-xs text-[var(--color-ink-soft)] mt-1">
                    Currently {t.pricePerPerson != null ? formatPrice(t.pricePerPerson) : '—'} per person.
                  </p>
                </label>
              ) : (
                <label className="block">
                  <span className="block text-sm font-medium mb-1">Flat price (USD)</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    value={d.flatPriceDollars}
                    onChange={(e) =>
                      setDrafts((prev) => ({
                        ...prev,
                        [t.slug]: { ...prev[t.slug]!, flatPriceDollars: e.target.value },
                      }))
                    }
                    className={inputClass}
                  />
                  <p className="text-xs text-[var(--color-ink-soft)] mt-1">
                    Currently {t.flatPrice != null ? formatPrice(t.flatPrice) : '—'} flat.
                  </p>
                </label>
              )}
            </div>

            <label className="block mt-3">
              <span className="block text-sm font-medium mb-1">Description</span>
              <textarea
                value={d.description}
                onChange={(e) =>
                  setDrafts((prev) => ({
                    ...prev,
                    [t.slug]: { ...prev[t.slug]!, description: e.target.value },
                  }))
                }
                rows={3}
                maxLength={4000}
                className={inputClass}
              />
            </label>

            <label className="block mt-3">
              <span className="block text-sm font-medium mb-1">What&rsquo;s included (one per line)</span>
              <textarea
                value={d.included}
                onChange={(e) =>
                  setDrafts((prev) => ({
                    ...prev,
                    [t.slug]: { ...prev[t.slug]!, included: e.target.value },
                  }))
                }
                rows={5}
                className={`${inputClass} font-mono text-sm`}
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

            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={() => save(t)}
                disabled={busy === t.slug}
                className="px-4 py-2 rounded-full bg-[var(--color-brand-blue)] hover:bg-[var(--color-brand-blue-dark)] text-white text-sm font-medium disabled:opacity-60"
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

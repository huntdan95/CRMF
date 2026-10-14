'use client';

import { useEffect, useState } from 'react';
import { admin } from '@/lib/admin-client';
import { FunctionError } from '@/lib/functions-client';
import { listAllTours } from '@/lib/admin-firestore';
import { formatPrice, getTourBySlug } from '@/lib/tours';
import { boatLabel } from '@/lib/experience';
import { clsx } from '@/lib/clsx';
import {
  Badge,
  PanelBody,
  PanelFooter,
  PanelHeader,
  Switch,
  buttonClass,
  hintClass,
  inputClass,
  labelClass,
  panelClass,
} from './ui';

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

/** "8:00 AM – 10:00 AM" and a "Shared boat" badge, from the built-in schedule. */
function ScheduleLine({ t }: { t: TourRow }) {
  const built = getTourBySlug(t.slug);
  if (!built) return <>{t.startTime}</>;
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="tabular-nums">
        {built.startTimeDisplay} – {built.endTimeDisplay}
      </span>
      <Badge tone={t.type === 'shared' ? 'spring' : 'sand'}>{boatLabel(built)}</Badge>
    </span>
  );
}

/** The departure time as a block, like the departures board on the website. */
function DepartureTile({ t, active }: { t: TourRow; active: boolean }) {
  const [time, meridiem] = (getTourBySlug(t.slug)?.startTimeDisplay ?? t.startTime).split(' ');
  return (
    <div
      aria-hidden
      className={clsx(
        'flex h-14 w-16 shrink-0 flex-col items-center justify-center rounded-xl',
        active
          ? 'bg-[var(--color-spring-deep)] text-white'
          : 'bg-[var(--color-ink)]/10 text-[var(--color-ink-soft)]',
      )}
    >
      <span className="font-display text-lg font-bold leading-none tabular-nums">{time}</span>
      {meridiem && (
        <span
          className={clsx(
            'mt-1 text-[0.65rem] font-semibold uppercase tracking-[0.14em]',
            active && 'text-[var(--color-spring-bright)]',
          )}
        >
          {meridiem}
        </span>
      )}
    </div>
  );
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
      if ((pricePerPerson != null && pricePerPerson < 50) || (flatPrice != null && flatPrice < 50)) {
        throw new Error('Prices must be at least $0.50.');
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
      <div className={clsx(panelClass, 'p-6 text-center text-sm text-[var(--color-ink-soft)] animate-pulse')}>
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
        <div className={clsx(panelClass, 'p-5 text-sm')}>
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
          <section key={t.slug} className={clsx(panelClass, 'overflow-hidden')}>
            <PanelHeader
              leading={<DepartureTile t={t} active={d.active} />}
              title={t.name}
              description={<ScheduleLine t={t} />}
              aside={
                <Switch checked={d.active} onChange={(active) => edit(t.slug, { active })}>
                  Taking bookings
                </Switch>
              }
            />
            {!d.active && (
              <p className="px-5 py-3 text-sm border-b border-[var(--color-line)] bg-[var(--color-sand)]/50">
                <strong className="font-semibold">Off:</strong> hidden from the booking page and nobody
                can book it. Its page on the website says it isn&rsquo;t running.
              </p>
            )}

            <PanelBody className="space-y-5">
              <div className="grid sm:grid-cols-2 gap-x-4 gap-y-5">
                <label className="block">
                  <span className={labelClass}>Name</span>
                  <input value={d.name} onChange={(e) => edit(t.slug, { name: e.target.value })} className={inputClass} />
                  <span className={hintClass}>
                    Shows on receipts, confirmation emails and Google search results.
                  </span>
                </label>
                {t.type === 'shared' ? (
                  <label className="block">
                    <span className={labelClass}>Standard price per person ($)</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      value={d.pricePerPersonDollars}
                      onChange={(e) => edit(t.slug, { pricePerPersonDollars: e.target.value })}
                      className={clsx(inputClass, 'tabular-nums')}
                    />
                    <span className={hintClass}>
                      Now {t.pricePerPerson != null ? formatPrice(t.pricePerPerson) : '—'} a seat. Seasonal rates below
                      override it on their dates.
                    </span>
                  </label>
                ) : (
                  <label className="block">
                    <span className={labelClass}>Standard price for the boat ($)</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      value={d.flatPriceDollars}
                      onChange={(e) => edit(t.slug, { flatPriceDollars: e.target.value })}
                      className={clsx(inputClass, 'tabular-nums')}
                    />
                    <span className={hintClass}>
                      Now {t.flatPrice != null ? formatPrice(t.flatPrice) : '—'}. Seasonal rates below override it on
                      their dates.
                    </span>
                  </label>
                )}
              </div>

              <label className="block">
                <span className={labelClass}>Description</span>
                <textarea
                  value={d.description}
                  onChange={(e) => edit(t.slug, { description: e.target.value })}
                  rows={3}
                  maxLength={4000}
                  // Grows with the text where the browser supports it.
                  className={clsx(inputClass, 'field-sizing-content')}
                />
              </label>

              <label className="block">
                <span className={labelClass}>What&rsquo;s included (one per line)</span>
                <textarea
                  value={d.included}
                  onChange={(e) => edit(t.slug, { included: e.target.value })}
                  // Tall enough to show the whole list, plus a line to add one.
                  rows={Math.max(5, d.included.split('\n').length + 1)}
                  className={clsx(inputClass, 'field-sizing-content')}
                />
              </label>
            </PanelBody>

            <PanelFooter>
              <div className="mr-auto flex flex-wrap items-center gap-x-3 gap-y-1">
                {myFlash && (
                  <p
                    role={myFlash.kind === 'err' ? 'alert' : 'status'}
                    className={clsx(
                      'text-sm font-medium',
                      myFlash.kind === 'ok' ? 'text-[var(--color-spring)]' : 'text-[var(--color-coral-dark)]',
                    )}
                  >
                    {myFlash.message}
                  </p>
                )}
                {dirty && <Badge tone="buoy">Unsaved changes</Badge>}
              </div>
              <button
                type="button"
                onClick={() => save(t)}
                disabled={busy === t.slug}
                className={buttonClass('primary')}
              >
                {busy === t.slug ? 'Saving…' : 'Save changes'}
              </button>
            </PanelFooter>
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

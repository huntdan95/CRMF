'use client';

import { useEffect, useState } from 'react';
import { admin } from '@/lib/admin-client';
import { FunctionError } from '@/lib/functions-client';
import { listAllTours } from '@/lib/admin-firestore';
import { bigPriceChange, priceChangeWords } from '@/lib/pricing';
import { formatPrice, getTourBySlug } from '@/lib/tours';
import { boatLabel } from '@/lib/experience';
import { clsx } from '@/lib/clsx';
import {
  Badge,
  PanelBody,
  PanelFooter,
  PanelHeader,
  Switch,
  TimeTile,
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

async function loadTours(): Promise<TourRow[]> {
  const list = (await listAllTours()) as TourRow[];
  return list.sort((a, b) => a.startTime.localeCompare(b.startTime) || a.type.localeCompare(b.type));
}

/** adminUpdateTour's limits on "What's included". */
const INCLUDED_MAX_LINES = 20;
const INCLUDED_LINE_MAX = 200;

function sameDraft(a: Draft, b: Draft): boolean {
  return (Object.keys(a) as Array<keyof Draft>).every((k) => a[k] === b[k]);
}

export function ToursAdmin() {
  const [tours, setTours] = useState<TourRow[] | null>(null);
  // Each card's draft, with its tour as it was when the draft was made (its
  // base). A save sends what differs from the base, not from the tour just
  // reloaded: a card kept through another card's save would otherwise send
  // back its old price over one changed meanwhile from MCP or another tab.
  const [cards, setCards] = useState<Record<string, { draft: Draft; base: TourRow }>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ slug: string; kind: 'ok' | 'err'; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * Resets `slug`'s draft (or all, on first load) and any card not edited,
   * so other cards keep their unsaved edits but none shows a stale price.
   */
  function apply(list: TourRow[], slug?: string) {
    setTours(list);
    setCards((prev) =>
      Object.fromEntries(
        list.map((t) => {
          const kept = prev[t.slug];
          const edited = kept && !sameDraft(kept.draft, toDraft(kept.base));
          return [t.slug, slug === undefined || t.slug === slug || !edited ? { draft: toDraft(t), base: t } : kept];
        }),
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
    setCards((prev) => ({ ...prev, [slug]: { ...prev[slug]!, draft: { ...prev[slug]!.draft, ...patch } } }));
  }

  async function save(t: TourRow) {
    const { draft: d, base } = cards[t.slug]!;
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
      // The function's limits, said here so Travis knows which line to fix.
      if (included.length > INCLUDED_MAX_LINES) {
        throw new Error(`“What’s included” can have up to ${INCLUDED_MAX_LINES} lines. It has ${included.length}.`);
      }
      const long = included.findIndex((line) => line.length > INCLUDED_LINE_MAX);
      if (long >= 0) {
        throw new Error(
          `Each line of “What’s included” can be up to ${INCLUDED_LINE_MAX} characters. Line ${long + 1} has ${included[long]!.length}: shorten it or split it in two.`,
        );
      }

      // Only what Travis changed on this card since its draft was made:
      // sending the rest back would undo a change made meanwhile from MCP or
      // another tab, like a new price wiped out by switching the tour off.
      const patch: Parameters<typeof admin.updateTour>[1] = {};
      if (d.name.trim() !== base.name) patch.name = d.name.trim();
      if (d.description.trim() !== base.description) patch.description = d.description.trim();
      if (pricePerPerson !== (base.pricePerPerson ?? null)) patch.pricePerPerson = pricePerPerson;
      if (flatPrice !== (base.flatPrice ?? null)) patch.flatPrice = flatPrice;
      if (d.active !== base.active) patch.active = d.active;
      if (included.join('\n') !== base.included.join('\n')) patch.included = included;

      // A slipped decimal point goes live on the next booking: ask first
      // when the price moves by more than half either way.
      const was = t.type === 'shared' ? base.pricePerPerson : base.flatPrice;
      const now = t.type === 'shared' ? patch.pricePerPerson : patch.flatPrice;
      if (was != null && now != null && bigPriceChange(was, now)) {
        const ok = confirm(
          `Change the ${t.type === 'shared' ? 'price per person' : 'boat price'} from ${formatPrice(was)} to ${formatPrice(now)}? ` +
            `That’s ${priceChangeWords(was, now)}. The next booking is charged it, so check it isn’t a typo.`,
        );
        if (!ok) return;
      }

      if (Object.keys(patch).length > 0) await admin.updateTour(t.slug, patch);
      setFlash({
        slug: t.slug,
        kind: 'ok',
        message: Object.keys(patch).length > 0 ? 'Saved. The website shows it now, or within a minute at most.' : 'Nothing had changed.',
      });
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
        const card = cards[t.slug];
        if (!card) return null;
        const d = card.draft;
        const myFlash = flash?.slug === t.slug ? flash : null;
        const dirty = !sameDraft(d, toDraft(card.base));
        return (
          <section key={t.slug} className={clsx(panelClass, 'overflow-hidden')}>
            <PanelHeader
              leading={
                <TimeTile
                  // The cruise has no fixed time: a word, not "90 min before sunset".
                  time={t.timeSlot === 'sunset' ? 'Sunset' : (getTourBySlug(t.slug)?.startTimeDisplay ?? t.startTime)}
                  muted={!d.active}
                />
              }
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
                  <input
                    value={d.name}
                    onChange={(e) => edit(t.slug, { name: e.target.value })}
                    maxLength={120}
                    className={inputClass}
                  />
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
                <span className={hintClass}>
                  Up to {INCLUDED_MAX_LINES} lines, each up to {INCLUDED_LINE_MAX} characters.
                </span>
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

'use client';

import { Suspense, useEffect, useState } from 'react';
import { admin } from '@/lib/admin-client';
import { getSiteSettings } from '@/lib/admin-firestore';
import { FunctionError } from '@/lib/functions-client';
// The same text the public page shows when nothing's been saved.
import { DEFAULT_CANCELLATION_POLICY as DEFAULT_POLICY } from '@/lib/cancellation-policy';
import { clsx } from '@/lib/clsx';
import {
  DEFAULT_GOOGLE_REVIEW_URL,
  wetsuitSizesFrom,
  type WetsuitSizes,
} from '@/lib/site-settings';
import { PanelBody, PanelFooter, PanelHeader, buttonClass, hintClass, inputClass, labelClass, panelClass } from './ui';
import { DriveConnection } from './DriveConnection';

type Flash = { kind: 'ok' | 'err'; message: string } | null;

function failure(err: unknown): Flash {
  return { kind: 'err', message: err instanceof FunctionError ? err.message : 'Failed to save.' };
}

/** Same as DEFAULT_UNDO_MINUTES and MAX_UNDO_MINUTES in functions/src/lib/close-day.ts. */
const DEFAULT_UNDO_MINUTES = 10;
const MAX_UNDO_MINUTES = 60;

export function SettingsAdmin() {
  const [policy, setPolicy] = useState('');
  const [email, setEmail] = useState('');
  const [loaded, setLoaded] = useState(false);
  // If the real settings didn't load, the form shows defaults: saving those
  // would quietly replace Travis's own policy, so saving is blocked.
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<{ kind: 'ok' | 'err'; message: string } | null>(null);
  const [undoMinutes, setUndoMinutes] = useState(String(DEFAULT_UNDO_MINUTES));
  const [undoBusy, setUndoBusy] = useState(false);
  const [undoFlash, setUndoFlash] = useState<{ kind: 'ok' | 'err'; message: string } | null>(null);
  const [reviewUrl, setReviewUrl] = useState(DEFAULT_GOOGLE_REVIEW_URL);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewFlash, setReviewFlash] = useState<Flash>(null);
  const [sizes, setSizes] = useState<WetsuitSizes>(() => wetsuitSizesFrom(null));
  const [sizesBusy, setSizesBusy] = useState(false);
  const [sizesFlash, setSizesFlash] = useState<Flash>(null);

  useEffect(() => {
    getSiteSettings()
      .then((s) => {
        setPolicy(s?.cancellationPolicyText ?? DEFAULT_POLICY);
        setEmail(s?.contactEmail ?? '');
        setUndoMinutes(String(s?.closureUndoMinutes ?? DEFAULT_UNDO_MINUTES));
        setReviewUrl(s?.googleReviewUrl || DEFAULT_GOOGLE_REVIEW_URL);
        setSizes(wetsuitSizesFrom(s));
        setLoaded(true);
      })
      .catch(() => {
        setPolicy(DEFAULT_POLICY);
        setLoadFailed(true);
        setLoaded(true);
      });
  }, []);

  async function save() {
    setBusy(true);
    setFlash(null);
    try {
      await admin.updateSettings({
        cancellationPolicyText: policy.trim(),
        contactEmail: email.trim() || undefined,
      });
      setFlash({ kind: 'ok', message: 'Saved.' });
    } catch (err) {
      setFlash({
        kind: 'err',
        message: err instanceof FunctionError ? err.message : 'Failed to save.',
      });
    } finally {
      setBusy(false);
    }
  }

  async function saveUndo() {
    setUndoFlash(null);
    const n = Number(undoMinutes);
    if (!Number.isInteger(n) || n < 0 || n > MAX_UNDO_MINUTES) {
      setUndoFlash({ kind: 'err', message: `Enter a whole number of minutes from 0 to ${MAX_UNDO_MINUTES}.` });
      return;
    }
    setUndoBusy(true);
    try {
      await admin.updateSettings({ closureUndoMinutes: n });
      setUndoFlash({ kind: 'ok', message: 'Saved.' });
    } catch (err) {
      setUndoFlash({
        kind: 'err',
        message: err instanceof FunctionError ? err.message : 'Failed to save.',
      });
    } finally {
      setUndoBusy(false);
    }
  }

  async function saveReviewUrl() {
    setReviewFlash(null);
    const url = reviewUrl.trim();
    if (!/^https:\/\/\S+$/.test(url)) {
      setReviewFlash({ kind: 'err', message: 'The link has to start with https://. Copy it from Google again.' });
      return;
    }
    setReviewBusy(true);
    try {
      await admin.updateSettings({ googleReviewUrl: url });
      setReviewFlash({ kind: 'ok', message: 'Saved.' });
    } catch (err) {
      setReviewFlash(failure(err));
    } finally {
      setReviewBusy(false);
    }
  }

  async function saveSizes() {
    setSizesFlash(null);
    if (sizes.adult.length === 0 || sizes.kids.length === 0) {
      setSizesFlash({ kind: 'err', message: 'Keep at least one adult and one kids’ size.' });
      return;
    }
    setSizesBusy(true);
    try {
      await admin.updateSettings({ wetsuitSizes: sizes });
      setSizesFlash({ kind: 'ok', message: 'Saved.' });
    } catch (err) {
      setSizesFlash(failure(err));
    } finally {
      setSizesBusy(false);
    }
  }

  if (!loaded) {
    return (
      <div className={clsx(panelClass, 'p-6 text-center text-sm text-[var(--color-ink-soft)] animate-pulse')}>
        Loading settings…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {loadFailed && (
        <div role="alert" className="rounded-2xl bg-[var(--color-coral)]/10 border border-[var(--color-coral)]/30 p-3 text-sm">
          Couldn’t load your current settings, so saving is switched off to
          protect them. Check your signal and reload the page.
        </div>
      )}
      <section className={clsx(panelClass, 'overflow-hidden')}>
        <PanelHeader
          title="Cancellation policy wording"
          description={
            <>
              This text appears on the{' '}
              <a href="/cancellation-policy" target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">
                Cancellation Policy page
              </a>
              . Changing it doesn’t change what customers get back: refunds are
              still worked out as full refund 72+ hours before, no refund
              after that.
            </>
          }
        />
        <PanelBody>
          <textarea
            value={policy}
            onChange={(e) => setPolicy(e.target.value)}
            rows={8}
            maxLength={4000}
            aria-label="Cancellation policy wording"
            className={inputClass}
          />
        </PanelBody>
        <PanelFooter>
          {flash && (
            <p
              role={flash.kind === 'err' ? 'alert' : 'status'}
              className={clsx(
                'mr-auto text-sm font-medium',
                flash.kind === 'ok' ? 'text-[var(--color-spring)]' : 'text-[var(--color-coral-dark)]',
              )}
            >
              {flash.message}
            </p>
          )}
          <button type="button" onClick={save} disabled={busy || loadFailed} className={buttonClass('primary')}>
            {busy ? 'Saving…' : 'Save settings'}
          </button>
        </PanelFooter>
      </section>

      <section className={clsx(panelClass, 'overflow-hidden')}>
        <PanelHeader
          title="Google review link"
          description="The “Review on Google” button in the thank-you email goes here. Only change it if Google gives you a new link."
        />
        <PanelBody>
          <input
            type="url"
            inputMode="url"
            value={reviewUrl}
            onChange={(e) => setReviewUrl(e.target.value)}
            maxLength={500}
            autoComplete="off"
            spellCheck={false}
            aria-label="Google review link"
            className={inputClass}
          />
          <a
            href={reviewUrl.trim()}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-block text-sm font-medium text-[var(--color-spring)] underline underline-offset-4"
          >
            Test the link
          </a>
        </PanelBody>
        <PanelFooter>
          <FlashText flash={reviewFlash} />
          <button type="button" onClick={saveReviewUrl} disabled={reviewBusy || loadFailed} className={buttonClass('primary')}>
            {reviewBusy ? 'Saving…' : 'Save'}
          </button>
        </PanelFooter>
      </section>

      <section className={clsx(panelClass, 'overflow-hidden')}>
        <PanelHeader
          title="Wetsuit sizes"
          description="Guests pick one of these for each person when they book, and the crew emails count them up. Bookings already made keep the size they picked."
        />
        <PanelBody className="space-y-5">
          <SizeList label="Adult" sizes={sizes.adult} onChange={(adult) => setSizes((s) => ({ ...s, adult }))} />
          <SizeList label="Kids" sizes={sizes.kids} onChange={(kids) => setSizes((s) => ({ ...s, kids }))} />
        </PanelBody>
        <PanelFooter>
          <FlashText flash={sizesFlash} />
          <button type="button" onClick={saveSizes} disabled={sizesBusy || loadFailed} className={buttonClass('primary')}>
            {sizesBusy ? 'Saving…' : 'Save'}
          </button>
        </PanelFooter>
      </section>

      <section className={clsx(panelClass, 'overflow-hidden')}>
        <PanelHeader
          title="Time to undo closing a day"
          description={
            <>
              After you close a day with people booked, the trips are blocked
              right away, but nobody is cancelled, refunded or emailed until
              this many minutes have passed. Until then you can tap Undo.
            </>
          }
        />
        <PanelBody>
          <label className="block max-w-xs">
            <span className={labelClass}>Minutes</span>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={MAX_UNDO_MINUTES}
              step={1}
              value={undoMinutes}
              onChange={(e) => setUndoMinutes(e.target.value)}
              className={inputClass}
            />
            <span className={hintClass}>
              {DEFAULT_UNDO_MINUTES} is the default. 0 sends right away, with no undo.
            </span>
          </label>
        </PanelBody>
        <PanelFooter>
          {undoFlash && (
            <p
              role={undoFlash.kind === 'err' ? 'alert' : 'status'}
              className={clsx(
                'mr-auto text-sm font-medium',
                undoFlash.kind === 'ok' ? 'text-[var(--color-spring)]' : 'text-[var(--color-coral-dark)]',
              )}
            >
              {undoFlash.message}
            </p>
          )}
          <button type="button" onClick={saveUndo} disabled={undoBusy || loadFailed} className={buttonClass('primary')}>
            {undoBusy ? 'Saving…' : 'Save'}
          </button>
        </PanelFooter>
      </section>

      {/* Its own buttons; nothing to do with the Save buttons above. */}
      <Suspense fallback={null}>
        <DriveConnection />
      </Suspense>
    </div>
  );
}

function FlashText({ flash }: { flash: Flash }) {
  if (!flash) return null;
  return (
    <p
      role={flash.kind === 'err' ? 'alert' : 'status'}
      className={clsx(
        'mr-auto text-sm font-medium',
        flash.kind === 'ok' ? 'text-[var(--color-spring)]' : 'text-[var(--color-coral-dark)]',
      )}
    >
      {flash.message}
    </p>
  );
}

/** One group of sizes: tap × to drop one, type and tap Add for a new one. */
function SizeList({
  label,
  sizes,
  onChange,
}: {
  label: 'Adult' | 'Kids';
  sizes: string[];
  onChange: (sizes: string[]) => void;
}) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  function add() {
    const size = draft.trim().toUpperCase();
    if (!size) return;
    if (sizes.some((s) => s.toLowerCase() === size.toLowerCase())) {
      setError(`${size} is already on the list.`);
      return;
    }
    onChange([...sizes, size]);
    setDraft('');
    setError(null);
  }

  return (
    <div>
      <h3 className={labelClass}>{label}</h3>
      <ul className="flex flex-wrap gap-2">
        {sizes.map((size) => (
          <li
            key={size}
            className="inline-flex items-center gap-1 rounded-full border border-[var(--color-line-strong)] bg-[var(--color-paper)] pl-3 pr-1 py-1 text-sm font-medium"
          >
            {size}
            <button
              type="button"
              onClick={() => onChange(sizes.filter((s) => s !== size))}
              aria-label={`Remove ${label.toLowerCase()} size ${size}`}
              className="w-8 h-8 inline-flex items-center justify-center rounded-full hover:bg-[var(--color-ink)]/10"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
              </svg>
            </button>
          </li>
        ))}
        {sizes.length === 0 && (
          <li className="text-sm text-[var(--color-coral-dark)]">No sizes. Add at least one.</li>
        )}
      </ul>
      <div className="mt-2 flex gap-2 max-w-xs">
        <input
          type="text"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
          maxLength={12}
          autoComplete="off"
          aria-label={`New ${label.toLowerCase()} size`}
          placeholder={label === 'Kids' ? 'e.g. 18' : 'e.g. 5XL'}
          className={inputClass}
        />
        <button type="button" onClick={add} className={clsx(buttonClass('secondary', 'sm'), 'shrink-0')}>
          Add
        </button>
      </div>
      {error && (
        <p role="alert" className="mt-1 text-sm text-[var(--color-coral-dark)]">
          {error}
        </p>
      )}
    </div>
  );
}

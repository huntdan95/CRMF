'use client';

import { Suspense, useEffect, useState } from 'react';
import { admin } from '@/lib/admin-client';
import { getSiteSettings } from '@/lib/admin-firestore';
import { FunctionError } from '@/lib/functions-client';
// The same text the public page shows when nothing's been saved.
import { DEFAULT_CANCELLATION_POLICY as DEFAULT_POLICY } from '@/lib/cancellation-policy';
import {
  DEFAULT_GOOGLE_REVIEW_URL,
  wetsuitSizesFrom,
  type WetsuitSizes,
} from '@/lib/site-settings';
import { DriveConnection } from './DriveConnection';

const inputClass =
  'w-full rounded-xl border border-[var(--color-ink)]/15 bg-white px-3 py-2 text-base focus:border-[var(--color-brand-blue)] focus:outline-2 focus:outline-[var(--color-brand-blue)]/20';

const cardClass =
  'bg-white rounded-2xl border border-[var(--color-ink)]/8 shadow-[var(--shadow-card)] p-5';

export function SettingsAdmin() {
  const [policy, setPolicy] = useState('');
  const [email, setEmail] = useState('');
  const [reviewUrl, setReviewUrl] = useState(DEFAULT_GOOGLE_REVIEW_URL);
  const [sizes, setSizes] = useState<WetsuitSizes>(() => wetsuitSizesFrom(null));
  const [loaded, setLoaded] = useState(false);
  // If the real settings didn't load, the form shows defaults: saving those
  // would quietly replace Travis's own policy, so saving is blocked.
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<{ kind: 'ok' | 'err'; message: string } | null>(null);

  useEffect(() => {
    getSiteSettings()
      .then((s) => {
        setPolicy(s?.cancellationPolicyText ?? DEFAULT_POLICY);
        setEmail(s?.contactEmail ?? '');
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
    const url = reviewUrl.trim();
    if (!/^https:\/\/\S+$/.test(url)) {
      setFlash({ kind: 'err', message: 'The Google review link has to start with https://. Copy it from Google again.' });
      return;
    }
    if (sizes.adult.length === 0 || sizes.kids.length === 0) {
      setFlash({ kind: 'err', message: 'Keep at least one adult and one kids’ wetsuit size.' });
      return;
    }
    setBusy(true);
    setFlash(null);
    try {
      await admin.updateSettings({
        cancellationPolicyText: policy.trim(),
        contactEmail: email.trim() || undefined,
        googleReviewUrl: url,
        wetsuitSizes: sizes,
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

  if (!loaded) {
    return (
      <div className="bg-white rounded-2xl border border-[var(--color-ink)]/8 p-6 text-center text-sm text-[var(--color-ink-soft)] animate-pulse">
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
      <section className={cardClass}>
        <h2 className="font-display text-lg mb-1">Cancellation policy wording</h2>
        <p className="text-sm text-[var(--color-ink-soft)] mb-3">
          This text appears on the{' '}
          <a href="/cancellation-policy" target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">
            Cancellation Policy page
          </a>
          . Changing it doesn’t change what customers get back: refunds are
          still worked out as full refund 72+ hours before, half refund
          24–72 hours before.
        </p>
        <textarea
          value={policy}
          onChange={(e) => setPolicy(e.target.value)}
          rows={8}
          maxLength={4000}
          className={inputClass}
        />
      </section>

      <section className={cardClass}>
        <h2 className="font-display text-lg mb-1">Google review link</h2>
        <p className="text-sm text-[var(--color-ink-soft)] mb-3">
          The “Review on Google” button in the thank-you email goes here.
          Only change it if Google gives you a new link.
        </p>
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
          className="mt-2 inline-block text-sm text-[var(--color-brand-blue)] underline underline-offset-4"
        >
          Test the link
        </a>
      </section>

      <section className={cardClass}>
        <h2 className="font-display text-lg mb-1">Wetsuit sizes</h2>
        <p className="text-sm text-[var(--color-ink-soft)] mb-4">
          Guests pick one of these for each person when they book, and the
          crew emails count them up. Bookings already made keep the size they
          picked.
        </p>
        <SizeList
          label="Adult"
          sizes={sizes.adult}
          onChange={(adult) => setSizes((s) => ({ ...s, adult }))}
        />
        <div className="mt-5">
          <SizeList
            label="Kids"
            sizes={sizes.kids}
            onChange={(kids) => setSizes((s) => ({ ...s, kids }))}
          />
        </div>
      </section>

      {flash && (
        <div
          role={flash.kind === 'err' ? 'alert' : 'status'}
          className={
            flash.kind === 'ok'
              ? 'rounded-2xl bg-[var(--color-brand-blue)]/10 border border-[var(--color-brand-blue)]/20 p-3 text-sm'
              : 'rounded-2xl bg-[var(--color-coral)]/10 border border-[var(--color-coral)]/30 p-3 text-sm'
          }
        >
          {flash.message}
        </div>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={save}
          disabled={busy || loadFailed}
          className="px-5 py-2.5 rounded-[10px] bg-[var(--color-brand-blue)] hover:bg-[var(--color-brand-blue-dark)] text-white font-medium disabled:opacity-60"
        >
          {busy ? 'Saving…' : 'Save settings'}
        </button>
      </div>

      {/* Its own buttons; nothing to do with Save settings above. */}
      <Suspense fallback={null}>
        <DriveConnection />
      </Suspense>
    </div>
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
      <h3 className="text-sm font-semibold mb-2">{label}</h3>
      <ul className="flex flex-wrap gap-2">
        {sizes.map((size) => (
          <li
            key={size}
            className="inline-flex items-center gap-1 rounded-full border border-[var(--color-ink)]/15 bg-[var(--color-paper)] pl-3 pr-1 py-1 text-sm font-medium"
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
        <button
          type="button"
          onClick={add}
          className="shrink-0 px-4 py-2 rounded-[10px] border border-[var(--color-ink)]/15 text-sm font-medium hover:bg-[var(--color-ink)]/5"
        >
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

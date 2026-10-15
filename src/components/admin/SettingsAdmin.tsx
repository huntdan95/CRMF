'use client';

import { useEffect, useState } from 'react';
import { admin } from '@/lib/admin-client';
import { getSiteSettings } from '@/lib/admin-firestore';
import { FunctionError } from '@/lib/functions-client';
// The same text the public page shows when nothing's been saved.
import { DEFAULT_CANCELLATION_POLICY as DEFAULT_POLICY } from '@/lib/cancellation-policy';
import { clsx } from '@/lib/clsx';
import { PanelBody, PanelFooter, PanelHeader, buttonClass, hintClass, inputClass, labelClass, panelClass } from './ui';

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

  useEffect(() => {
    getSiteSettings()
      .then((s) => {
        setPolicy(s?.cancellationPolicyText ?? DEFAULT_POLICY);
        setEmail(s?.contactEmail ?? '');
        setUndoMinutes(String(s?.closureUndoMinutes ?? DEFAULT_UNDO_MINUTES));
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
              still worked out as full refund 72+ hours before, half refund
              24–72 hours before.
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
    </div>
  );
}

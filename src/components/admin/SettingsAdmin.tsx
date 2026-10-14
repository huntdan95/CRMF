'use client';

import { useEffect, useState } from 'react';
import { admin } from '@/lib/admin-client';
import { getSiteSettings } from '@/lib/admin-firestore';
import { FunctionError } from '@/lib/functions-client';
// The same text the public page shows when nothing's been saved.
import { DEFAULT_CANCELLATION_POLICY as DEFAULT_POLICY } from '@/lib/cancellation-policy';

const inputClass =
  'w-full rounded-xl border border-[var(--color-ink)]/15 bg-white px-3 py-2 text-base focus:border-[var(--color-brand-blue)] focus:outline-2 focus:outline-[var(--color-brand-blue)]/20';

export function SettingsAdmin() {
  const [policy, setPolicy] = useState('');
  const [email, setEmail] = useState('');
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
      <section className="bg-white rounded-2xl border border-[var(--color-ink)]/8 shadow-[var(--shadow-card)] p-5">
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
    </div>
  );
}

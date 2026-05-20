'use client';

import { useEffect, useState } from 'react';
import { admin } from '@/lib/admin-client';
import { getSiteSettings } from '@/lib/admin-firestore';
import { FunctionError } from '@/lib/functions-client';

const DEFAULT_POLICY = [
  '72+ hours before tour: full refund.',
  '24-72 hours before tour: 50% refund.',
  'Less than 24 hours: no refund (call for emergencies).',
  'Travis-cancelled (weather, etc.): always full refund.',
].join('\n');

const inputClass =
  'w-full rounded-xl border border-[var(--color-ink)]/15 bg-white px-3 py-2 text-base focus:border-[var(--color-brand-blue)] focus:outline-2 focus:outline-[var(--color-brand-blue)]/20';

export function SettingsAdmin() {
  const [policy, setPolicy] = useState('');
  const [email, setEmail] = useState('');
  const [loaded, setLoaded] = useState(false);
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
      <section className="bg-white rounded-2xl border border-[var(--color-ink)]/8 shadow-[var(--shadow-card)] p-5">
        <h2 className="font-display text-lg mb-1">Cancellation policy text</h2>
        <p className="text-xs text-[var(--color-ink-soft)] mb-3">
          Shown in the customer booking flow and the self-service page. The
          underlying refund tiers (72h / 24h) are still enforced by code — this
          is just the human-readable explanation.
        </p>
        <textarea
          value={policy}
          onChange={(e) => setPolicy(e.target.value)}
          rows={8}
          maxLength={4000}
          className={`${inputClass} font-mono text-sm`}
        />
      </section>

      <section className="bg-white rounded-2xl border border-[var(--color-ink)]/8 shadow-[var(--shadow-card)] p-5">
        <h2 className="font-display text-lg mb-1">Contact email</h2>
        <p className="text-xs text-[var(--color-ink-soft)] mb-3">
          Shown on the public Contact page. Leave empty to fall back to the
          phone-only contact instructions.
        </p>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="travis@crystalrivermanateefun.com"
          className={inputClass}
        />
      </section>

      {flash && (
        <div
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
          disabled={busy}
          className="px-5 py-2.5 rounded-full bg-[var(--color-brand-blue)] hover:bg-[var(--color-brand-blue-dark)] text-white font-medium disabled:opacity-60"
        >
          {busy ? 'Saving…' : 'Save settings'}
        </button>
      </div>
    </div>
  );
}

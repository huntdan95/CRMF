'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

const inputClass =
  'w-full h-12 rounded-[10px] border border-[var(--color-ink)]/20 bg-white px-3 text-base focus:border-[var(--color-spring)] focus:outline-2 focus:outline-[var(--color-spring)]/20';

export function CrewLoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/crew/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Sign-in failed (${res.status})`);
      }
      router.replace('/crew');
      router.refresh();
    } catch (err) {
      setError(
        err instanceof TypeError
          ? 'Couldn’t reach the server. Check your connection.'
          : err instanceof Error
            ? err.message
            : 'Sign-in failed.',
      );
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {error && (
        <div
          role="alert"
          className="rounded-lg bg-[var(--color-error)]/5 border border-[var(--color-error)]/30 px-3 py-2 text-sm"
        >
          {error}
        </div>
      )}
      <label className="block">
        <span className="mb-1 block text-sm font-semibold">Email</span>
        <input
          type="email"
          name="email"
          autoComplete="username"
          autoCapitalize="none"
          inputMode="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={inputClass}
        />
      </label>
      <label className="block">
        <span className="mb-1 flex items-center justify-between text-sm font-semibold">
          Password
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="text-xs font-semibold text-[var(--color-spring)]"
          >
            {showPassword ? 'Hide' : 'Show'}
          </button>
        </span>
        <input
          type={showPassword ? 'text' : 'password'}
          name="password"
          autoComplete="current-password"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={inputClass}
        />
      </label>
      <button
        type="submit"
        disabled={busy}
        className="w-full inline-flex h-12 items-center justify-center rounded-[10px] bg-[var(--color-buoy)] px-5 font-semibold text-[var(--color-ink)] hover:bg-[var(--color-buoy-deep)] disabled:opacity-60"
      >
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
      <p className="text-xs text-[var(--color-ink-soft)]">
        Forgot it? Ask Travis to reset your password.
      </p>
    </form>
  );
}

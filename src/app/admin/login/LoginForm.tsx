'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  signInWithGoogle,
  adminSignOut,
} from '@/lib/firebase/auth-client';

interface Props {
  nextPath: string;
  initialError: string | null;
}

export function LoginForm({ nextPath, initialError }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(initialError);

  async function signIn() {
    setBusy(true);
    setError(null);
    try {
      const user = await signInWithGoogle();
      const idToken = await user.getIdToken(true);

      const res = await fetch('/api/admin/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        await adminSignOut().catch(() => undefined);
        throw new Error(body.error ?? `Sign-in failed (${res.status})`);
      }

      router.replace(nextPath);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed.');
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {error && (
        <div
          role="alert"
          className="rounded-2xl bg-[var(--color-coral)]/10 border border-[var(--color-coral)]/30 px-3 py-2 text-sm"
        >
          {error}
        </div>
      )}
      <button
        type="button"
        onClick={signIn}
        disabled={busy}
        className="w-full inline-flex items-center justify-center gap-3 px-5 py-3 rounded-full bg-white border border-[var(--color-ink)]/20 text-[var(--color-ink)] hover:bg-[var(--color-cream)] disabled:opacity-60 font-medium"
      >
        <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden>
          <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.3 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
          <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16 19 13 24 13c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.3 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
          <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.5-5.2l-6.2-5.3C29.2 35 26.7 36 24 36c-5.2 0-9.6-3.3-11.2-7.9l-6.6 5.1C9.5 39.6 16.2 44 24 44z" />
          <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.2 4.3-4 5.7l6.2 5.3C41.9 35.4 44 30 44 24c0-1.3-.1-2.4-.4-3.5z" />
        </svg>
        {busy ? 'Signing in…' : 'Continue with Google'}
      </button>
    </div>
  );
}

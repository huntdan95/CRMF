'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Signs this phone out and turns its notifications off — signing out
 * means "this phone shouldn't be on the crew list any more".
 */
export function CrewSignOut() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    try {
      const reg =
        'serviceWorker' in navigator
          ? await navigator.serviceWorker.getRegistration('/crew')
          : undefined;
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await fetch('/api/crew/push', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        }).catch(() => undefined);
        await sub.unsubscribe().catch(() => undefined);
      }
      await fetch('/api/crew/session', { method: 'DELETE' });
      router.replace('/crew/login');
      router.refresh();
    } catch {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={signOut}
      disabled={busy}
      className="inline-flex h-10 w-full items-center justify-center rounded-[10px] border border-[var(--color-ink)]/20 px-4 text-sm font-semibold hover:border-[var(--color-ink)] disabled:opacity-60"
    >
      {busy ? 'Signing out…' : 'Sign out'}
    </button>
  );
}

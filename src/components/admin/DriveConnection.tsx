'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

interface DriveStatus {
  configured: boolean;
  connected: boolean;
  accountEmail: string | null;
  connectedAt: string | null;
  lastError: string | null;
  folderUrl: string | null;
}

/** What came back from Google, as Settings shows it. */
const OUTCOME: Record<string, { kind: 'ok' | 'err'; message: string }> = {
  connected: { kind: 'ok', message: 'Google Drive is connected. New trip photos will be copied to “Manatee Fun Trip Photos”.' },
  refused: { kind: 'err', message: 'Google Drive wasn’t connected: access wasn’t allowed.' },
  expired: { kind: 'err', message: 'That took too long. Tap Connect Google Drive again.' },
  error: { kind: 'err', message: 'Google Drive didn’t connect. Try again, and make sure the Drive box is ticked.' },
  'not-configured': {
    kind: 'err',
    message: 'The site isn’t set up for Google Drive yet (its Google sign-in keys are missing).',
  },
};

/**
 * Admin → Settings: the Google Drive every trip photo the crew upload is
 * also copied into ("Manatee Fun Trip Photos", one folder per trip) for
 * Grok Bot and the blog. The guest gallery works whether or not Drive is
 * connected. A connection made with `npm run connect:drive` shows here as
 * connected (src/lib/google-drive.ts).
 */
export function DriveConnection() {
  const params = useSearchParams();
  const outcome = OUTCOME[params.get('drive') ?? ''];
  const [status, setStatus] = useState<DriveStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const res = await fetch('/api/admin/google-drive', { cache: 'no-store' });
      if (!res.ok) throw new Error();
      setStatus((await res.json()) as DriveStatus);
      setError(null);
    } catch {
      setError('Couldn’t check Google Drive. Reload the page to try again.');
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load
    load();
  }, []);

  async function disconnect() {
    if (!confirm('Stop copying trip photos to Google Drive? Photos already there stay there.')) return;
    setBusy(true);
    try {
      const res = await fetch('/api/admin/google-drive', { method: 'DELETE' });
      if (!res.ok) throw new Error();
      await load();
    } catch {
      setError('Couldn’t disconnect. Try again.');
    } finally {
      setBusy(false);
    }
  }

  const since = status?.connectedAt
    ? new Date(status.connectedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : null;

  return (
    <section className="bg-white rounded-2xl border border-[var(--color-ink)]/8 shadow-[var(--shadow-card)] p-5 space-y-3">
      <div>
        <h2 className="font-display text-lg mb-1">Google Drive for trip photos</h2>
        <p className="text-sm text-[var(--color-ink-soft)]">
          Every photo and video the crew upload is copied into the “Manatee Fun
          Trip Photos” folder in your Google Drive, one folder per trip, for
          Grok Bot and the blog. The
          site can only see the folders it makes there, nothing else in your
          Drive. Guests get their photos either way.
        </p>
      </div>

      {outcome && (
        <p
          role={outcome.kind === 'err' ? 'alert' : 'status'}
          className={
            outcome.kind === 'ok'
              ? 'rounded-xl bg-[var(--color-brand-blue)]/10 border border-[var(--color-brand-blue)]/20 p-3 text-sm'
              : 'rounded-xl bg-[var(--color-coral)]/10 border border-[var(--color-coral)]/30 p-3 text-sm'
          }
        >
          {outcome.message}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-[var(--color-coral-dark)]">
          {error}
        </p>
      )}

      {status === null && !error && <p className="text-sm text-[var(--color-ink-soft)] animate-pulse">Checking…</p>}

      {status && status.connected && (
        <div className="space-y-2 text-sm">
          <p>
            <strong>Connected</strong>
            {status.accountEmail ? ` as ${status.accountEmail}` : ''}
            {since ? ` since ${since}` : ''}.
          </p>
          {status.lastError && (
            <p className="rounded-xl bg-[var(--color-coral)]/10 border border-[var(--color-coral)]/30 p-3">
              The last copy couldn’t sign in to Google ({status.lastError}). Connect again to fix it.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {status.folderUrl && (
              <a
                href={status.folderUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="px-4 py-2 rounded-[10px] border border-[var(--color-ink)]/15 font-medium hover:bg-[var(--color-ink)]/5"
              >
                Open the folder
              </a>
            )}
            {status.lastError && (
              <a
                href="/api/admin/google-drive/connect"
                className="px-4 py-2 rounded-[10px] border border-[var(--color-ink)]/15 font-medium hover:bg-[var(--color-ink)]/5"
              >
                Connect again
              </a>
            )}
            <button
              type="button"
              onClick={disconnect}
              disabled={busy}
              className="px-4 py-2 rounded-[10px] border border-[var(--color-ink)]/15 font-medium text-[var(--color-coral-dark)] hover:bg-[var(--color-ink)]/5 disabled:opacity-60"
            >
              {busy ? 'Disconnecting…' : 'Disconnect'}
            </button>
          </div>
        </div>
      )}

      {status && !status.connected && (
        <div className="space-y-2">
          <p className="text-sm">Not connected. Photos still reach guests; they just aren’t copied to Drive.</p>
          {status.configured ? (
            <a
              href="/api/admin/google-drive/connect"
              className="inline-flex px-5 py-2.5 rounded-[10px] bg-[var(--color-brand-blue)] hover:bg-[var(--color-brand-blue-dark)] text-white font-medium"
            >
              Connect Google Drive
            </a>
          ) : (
            <p className="text-sm text-[var(--color-ink-soft)]">
              The site isn’t set up for Google Drive yet (the Google sign-in keys are missing).
            </p>
          )}
        </div>
      )}
    </section>
  );
}

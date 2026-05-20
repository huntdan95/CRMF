'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  listRecentAuditLog,
  type AuditEntryDoc,
} from '@/lib/admin-firestore';
import { clsx } from '@/lib/clsx';

const ACTION_LABELS: Record<string, string> = {
  'booking.create': 'Booking created',
  'booking.update': 'Booking updated',
  'booking.cancel': 'Booking cancelled',
  'booking.refund': 'Partial refund issued',
  'booking.reschedule': 'Booking rescheduled',
  'booking.no-show': 'Marked no-show',
  'booking.complete': 'Marked completed',
  'blackout.create': 'Blackout added',
  'blackout.delete': 'Blackout removed',
  'tour.update': 'Tour updated',
  'siteImage.update': 'Site photo uploaded',
  'siteImage.delete': 'Site photo removed',
  'testimonial.upsert': 'Review saved',
  'testimonial.delete': 'Review deleted',
};

const ACTION_COLOR: Record<string, string> = {
  'booking.cancel': 'bg-[var(--color-coral)]/15 text-[var(--color-coral-dark)]',
  'booking.refund': 'bg-[var(--color-coral)]/15 text-[var(--color-coral-dark)]',
  'blackout.create': 'bg-[var(--color-coral)]/15 text-[var(--color-coral-dark)]',
  'blackout.delete': 'bg-[var(--color-coral)]/15 text-[var(--color-coral-dark)]',
};

function formatWhen(ts: AuditEntryDoc['createdAt']): string {
  if (!ts) return '—';
  return new Date(ts.seconds * 1000).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function ActivityAdmin() {
  const [rows, setRows] = useState<AuditEntryDoc[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionFilter, setActionFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    listRecentAuditLog()
      .then(setRows)
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'Failed to load.'),
      );
  }, []);

  const actionsInData = useMemo(() => {
    if (!rows) return [];
    return Array.from(new Set(rows.map((r) => r.action))).sort();
  }, [rows]);

  const filtered = useMemo(() => {
    if (!rows) return null;
    let out = rows;
    if (actionFilter !== 'all') {
      out = out.filter((r) => r.action === actionFilter);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      out = out.filter((r) =>
        `${r.actorEmail} ${r.targetId} ${r.action} ${JSON.stringify(r.payload)}`
          .toLowerCase()
          .includes(q),
      );
    }
    return out;
  }, [rows, actionFilter, search]);

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-2xl bg-[var(--color-coral)]/10 border border-[var(--color-coral)]/30 p-3 text-sm">
          {error}
        </div>
      )}

      <div className="flex flex-wrap gap-2 items-center justify-between">
        <select
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value)}
          className="rounded-full border border-[var(--color-ink)]/15 bg-white px-3 py-1.5 text-xs"
        >
          <option value="all">All actions ({rows?.length ?? 0})</option>
          {actionsInData.map((a) => (
            <option key={a} value={a}>
              {ACTION_LABELS[a] ?? a} (
              {rows?.filter((r) => r.action === a).length ?? 0})
            </option>
          ))}
        </select>
        <input
          type="search"
          placeholder="Search target id, email, payload…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="rounded-full border border-[var(--color-ink)]/15 bg-white px-4 py-1.5 text-xs w-full sm:w-72"
        />
      </div>

      {rows === null ? (
        <div className="bg-white rounded-2xl border border-[var(--color-ink)]/8 p-8 text-center text-sm text-[var(--color-ink-soft)] animate-pulse">
          Loading…
        </div>
      ) : filtered?.length === 0 ? (
        <div className="bg-[var(--color-cream)] rounded-2xl p-8 text-center text-sm text-[var(--color-ink-soft)]">
          No matching entries.
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-[var(--color-ink)]/8 shadow-[var(--shadow-card)] overflow-hidden">
          <table className="min-w-full text-sm">
            <thead className="bg-[var(--color-cream)] text-[var(--color-ink-soft)]">
              <tr>
                <th className="text-left px-4 py-2 font-medium uppercase text-xs tracking-widest">When</th>
                <th className="text-left px-4 py-2 font-medium uppercase text-xs tracking-widest">Who</th>
                <th className="text-left px-4 py-2 font-medium uppercase text-xs tracking-widest">Action</th>
                <th className="text-left px-4 py-2 font-medium uppercase text-xs tracking-widest">Target</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered?.map((r) => (
                <>
                  <tr
                    key={r.id}
                    className="border-t border-[var(--color-ink)]/8 hover:bg-[var(--color-cream)]/40 cursor-pointer"
                    onClick={() => toggle(r.id)}
                  >
                    <td className="px-4 py-2 text-xs text-[var(--color-ink-soft)] whitespace-nowrap">
                      {formatWhen(r.createdAt)}
                    </td>
                    <td className="px-4 py-2 text-xs">
                      {r.actorEmail.replace('@gmail.com', '')}
                    </td>
                    <td className="px-4 py-2">
                      <span
                        className={clsx(
                          'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium',
                          ACTION_COLOR[r.action] ??
                            'bg-[var(--color-brand-blue)]/10 text-[var(--color-brand-blue-dark)]',
                        )}
                      >
                        {ACTION_LABELS[r.action] ?? r.action}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-xs font-mono text-[var(--color-ink-soft)] break-all">
                      {r.targetId}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button
                        type="button"
                        className="text-xs text-[var(--color-brand-blue)] hover:underline"
                      >
                        {expanded.has(r.id) ? 'Hide' : 'Show'}
                      </button>
                    </td>
                  </tr>
                  {expanded.has(r.id) && (
                    <tr key={`${r.id}-payload`} className="bg-[var(--color-cream)]/40">
                      <td colSpan={5} className="px-4 py-3">
                        <pre className="text-xs font-mono overflow-x-auto whitespace-pre-wrap text-[var(--color-ink)]">
                          {JSON.stringify(r.payload ?? {}, null, 2)}
                        </pre>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {rows && rows.length === 200 && (
        <p className="text-xs text-[var(--color-ink-soft)] text-center">
          Showing the most recent 200 entries. For full history use the
          Firebase console.
        </p>
      )}
    </div>
  );
}

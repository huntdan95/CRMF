'use client';

import { useEffect, useMemo, useState } from 'react';
import { admin } from '@/lib/admin-client';
import { FunctionError } from '@/lib/functions-client';
import {
  listAllContactMessages,
  type ContactMessageDoc,
} from '@/lib/admin-firestore';
import { clsx } from '@/lib/clsx';

const STATUS_LABEL: Record<ContactMessageDoc['status'], string> = {
  new: 'New',
  replied: 'Replied',
  archived: 'Archived',
};

const STATUS_CLASS: Record<ContactMessageDoc['status'], string> = {
  new: 'bg-[var(--color-coral)]/15 text-[var(--color-coral-dark)]',
  replied: 'bg-[var(--color-brand-blue)]/15 text-[var(--color-brand-blue-dark)]',
  archived: 'bg-[var(--color-ink)]/10 text-[var(--color-ink-soft)]',
};

const FILTERS: Array<{ value: 'all' | ContactMessageDoc['status']; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'new', label: 'New' },
  { value: 'replied', label: 'Replied' },
  { value: 'archived', label: 'Archived' },
];

function tsToDate(ts: ContactMessageDoc['createdAt']): Date | null {
  if (!ts) return null;
  return new Date(ts.seconds * 1000);
}

function formatWhen(ts: ContactMessageDoc['createdAt']): string {
  const d = tsToDate(ts);
  if (!d) return '—';
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function MessagesAdmin() {
  const [rows, setRows] = useState<ContactMessageDoc[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | ContactMessageDoc['status']>('new');
  const [busyId, setBusyId] = useState<string | null>(null);

  async function refresh() {
    setError(null);
    try {
      setRows(await listAllContactMessages());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load.');
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  const filtered = useMemo(() => {
    if (!rows) return null;
    return filter === 'all' ? rows : rows.filter((r) => r.status === filter);
  }, [rows, filter]);

  async function setStatus(id: string, status: ContactMessageDoc['status']) {
    setBusyId(id);
    try {
      await admin.updateContactMessage(id, status);
      await refresh();
    } catch (err) {
      setError(
        err instanceof FunctionError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Update failed.',
      );
    } finally {
      setBusyId(null);
    }
  }

  const newCount = rows?.filter((r) => r.status === 'new').length ?? 0;

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-2xl bg-[var(--color-coral)]/10 border border-[var(--color-coral)]/30 p-3 text-sm">
          {error}
        </div>
      )}

      <div className="flex flex-wrap gap-2 items-center justify-between">
        <div className="flex flex-wrap gap-1">
          {FILTERS.map((f) => {
            const count =
              f.value === 'all'
                ? rows?.length
                : rows?.filter((r) => r.status === f.value).length;
            return (
              <button
                key={f.value}
                type="button"
                onClick={() => setFilter(f.value)}
                className={clsx(
                  'inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border',
                  filter === f.value
                    ? 'bg-[var(--color-brand-blue)] text-white border-[var(--color-brand-blue)]'
                    : 'bg-white text-[var(--color-ink)] border-[var(--color-ink)]/15 hover:bg-[var(--color-ink)]/5',
                )}
              >
                {f.label}
                {count !== undefined && (
                  <span
                    className={clsx(
                      'inline-flex items-center px-1.5 rounded-full text-[10px]',
                      filter === f.value
                        ? 'bg-white/20'
                        : 'bg-[var(--color-ink)]/8',
                    )}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        {newCount > 0 && (
          <p className="text-xs text-[var(--color-coral-dark)] font-medium">
            {newCount} new {newCount === 1 ? 'message' : 'messages'} to read
          </p>
        )}
      </div>

      {rows === null ? (
        <div className="bg-white rounded-2xl border border-[var(--color-ink)]/8 p-8 text-center text-sm text-[var(--color-ink-soft)] animate-pulse">
          Loading…
        </div>
      ) : filtered?.length === 0 ? (
        <div className="bg-[var(--color-cream)] rounded-2xl p-8 text-center text-sm text-[var(--color-ink-soft)]">
          {filter === 'new'
            ? 'No unread messages. 🎉'
            : `No ${filter} messages.`}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered?.map((m) => (
            <article
              key={m.id}
              className={clsx(
                'bg-white rounded-2xl border shadow-[var(--shadow-card)] p-5',
                m.status === 'new'
                  ? 'border-[var(--color-coral)]/30 ring-1 ring-[var(--color-coral)]/15'
                  : 'border-[var(--color-ink)]/8',
              )}
            >
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap text-sm">
                    <span className="font-medium">{m.name}</span>
                    <a
                      href={`mailto:${m.email}`}
                      className="text-[var(--color-brand-blue)] hover:underline"
                    >
                      &lt;{m.email}&gt;
                    </a>
                    {m.phone && (
                      <a
                        href={`tel:${m.phone}`}
                        className="text-[var(--color-ink-soft)] hover:text-[var(--color-brand-blue)]"
                      >
                        · {m.phone}
                      </a>
                    )}
                  </div>
                  {m.subject && (
                    <p className="mt-1 text-sm font-medium text-[var(--color-ink)]">
                      Re: {m.subject}
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap gap-2 shrink-0">
                  <span
                    className={clsx(
                      'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium',
                      STATUS_CLASS[m.status],
                    )}
                  >
                    {STATUS_LABEL[m.status]}
                  </span>
                  <span className="text-xs text-[var(--color-ink-soft)] self-center">
                    {formatWhen(m.createdAt)}
                  </span>
                </div>
              </div>

              <p className="mt-3 text-sm whitespace-pre-wrap leading-relaxed text-[var(--color-ink)]">
                {m.message}
              </p>

              <div className="mt-4 pt-3 border-t border-[var(--color-ink)]/8 flex flex-wrap gap-2 text-xs">
                <a
                  href={`mailto:${m.email}${m.subject ? `?subject=${encodeURIComponent('Re: ' + m.subject)}` : ''}`}
                  className="inline-flex items-center px-3 py-1.5 rounded-full bg-[var(--color-brand-blue)] hover:bg-[var(--color-brand-blue-dark)] text-white font-medium"
                >
                  Reply via email →
                </a>
                {m.status !== 'replied' && (
                  <button
                    type="button"
                    onClick={() => setStatus(m.id, 'replied')}
                    disabled={busyId === m.id}
                    className="inline-flex items-center px-3 py-1.5 rounded-full border border-[var(--color-ink)]/15 hover:bg-[var(--color-ink)]/5 disabled:opacity-60"
                  >
                    Mark replied
                  </button>
                )}
                {m.status !== 'archived' && (
                  <button
                    type="button"
                    onClick={() => setStatus(m.id, 'archived')}
                    disabled={busyId === m.id}
                    className="inline-flex items-center px-3 py-1.5 rounded-full border border-[var(--color-ink)]/15 hover:bg-[var(--color-ink)]/5 disabled:opacity-60"
                  >
                    Archive
                  </button>
                )}
                {m.status !== 'new' && (
                  <button
                    type="button"
                    onClick={() => setStatus(m.id, 'new')}
                    disabled={busyId === m.id}
                    className="inline-flex items-center px-3 py-1.5 rounded-full text-[var(--color-ink-soft)] hover:bg-[var(--color-ink)]/5 disabled:opacity-60"
                  >
                    Mark unread
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

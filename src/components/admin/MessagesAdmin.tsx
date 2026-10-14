'use client';

import { useEffect, useMemo, useState } from 'react';
import { admin } from '@/lib/admin-client';
import { FunctionError } from '@/lib/functions-client';
import {
  listAllContactMessages,
  type ContactMessageDoc,
} from '@/lib/admin-firestore';
import { clsx } from '@/lib/clsx';
import { Chat, Mail, Phone } from '@/components/ui/icons';
import { Avatar, Badge, FilterTabs, PanelFooter, buttonClass, panelClass, type BadgeTone } from './ui';

const STATUS_LABEL: Record<ContactMessageDoc['status'], string> = {
  new: 'New',
  replied: 'Replied',
  archived: 'Archived',
};

const STATUS_TONE: Record<ContactMessageDoc['status'], BadgeTone> = {
  new: 'buoy',
  replied: 'spring',
  archived: 'muted',
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
    // Marina time, wherever Travis is reading it.
    timeZone: 'America/New_York',
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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loading on mount
    void refresh();
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
    <div className="space-y-5">
      {error && (
        <div className="rounded-2xl bg-[var(--color-coral)]/10 border border-[var(--color-coral)]/30 p-3 text-sm">
          {error}
        </div>
      )}

      <div className="flex flex-wrap gap-3 items-center justify-between">
        <FilterTabs
          label="Show messages"
          options={FILTERS.map((f) => ({
            ...f,
            count: f.value === 'all' ? rows?.length : rows?.filter((r) => r.status === f.value).length,
          }))}
          value={filter}
          onChange={setFilter}
        />
        {newCount > 0 && (
          <Badge tone="buoy" size="md">
            {newCount} new {newCount === 1 ? 'message' : 'messages'} to read
          </Badge>
        )}
      </div>

      {rows === null ? (
        <div className={clsx(panelClass, 'p-8 text-center text-sm text-[var(--color-ink-soft)] animate-pulse')}>
          Loading…
        </div>
      ) : filtered?.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[var(--color-line-strong)] bg-white/50 p-8 text-center text-sm text-[var(--color-ink-soft)]">
          {filter === 'new'
            ? 'No unread messages. 🎉'
            : `No ${filter} messages.`}
        </div>
      ) : (
        <div className="space-y-4">
          {filtered?.map((m) => {
            const phone = m.phone?.replace(/[^\d+]/g, '');
            return (
              <article
                key={m.id}
                className={clsx(
                  panelClass,
                  'relative overflow-hidden',
                  // An orange edge down the left marks the ones still to read.
                  m.status === 'new' &&
                    'before:absolute before:inset-y-0 before:left-0 before:w-1 before:bg-[var(--color-buoy)]',
                )}
              >
                <div className="flex flex-wrap items-start gap-x-4 gap-y-2 px-5 py-4 border-b border-[var(--color-line)] bg-[var(--color-paper)]/70">
                  <Avatar name={m.name} />
                  <div className="min-w-0 flex-1 basis-48">
                    <p className="font-semibold">{m.name}</p>
                    <p className="text-sm text-[var(--color-ink-soft)]">
                      <span className="break-all">{m.email}</span>
                      {m.phone && (
                        <>
                          <span className="hidden sm:inline"> · </span>
                          <span className="block sm:inline whitespace-nowrap">{m.phone}</span>
                        </>
                      )}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={STATUS_TONE[m.status]}>{STATUS_LABEL[m.status]}</Badge>
                    <span className="text-xs text-[var(--color-ink-soft)] tabular-nums">
                      {formatWhen(m.createdAt)}
                    </span>
                  </div>
                </div>

                <div className={clsx('p-5', m.status === 'archived' && 'text-[var(--color-ink-soft)]')}>
                  {m.subject && <p className="font-semibold">Re: {m.subject}</p>}
                  <p className={clsx('text-[0.9375rem] whitespace-pre-wrap leading-relaxed', m.subject && 'mt-2')}>
                    {m.message}
                  </p>
                </div>

                <PanelFooter>
                  <div className="mr-auto flex flex-wrap gap-2">
                    {phone && (
                      <>
                        <a href={`tel:${phone}`} className={buttonClass('contact', 'sm')}>
                          <Phone size={15} /> Call
                        </a>
                        <a href={`sms:${phone}`} className={buttonClass('contact', 'sm')}>
                          <Chat size={15} /> Text
                        </a>
                      </>
                    )}
                    <a
                      href={`mailto:${m.email}${m.subject ? `?subject=${encodeURIComponent('Re: ' + m.subject)}` : ''}`}
                      className={buttonClass('contact', 'sm')}
                    >
                      <Mail size={15} /> Reply by email
                    </a>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {m.status !== 'replied' && (
                      <button
                        type="button"
                        onClick={() => setStatus(m.id, 'replied')}
                        disabled={busyId === m.id}
                        className={buttonClass('secondary', 'sm')}
                      >
                        I’ve replied
                      </button>
                    )}
                    {m.status !== 'archived' && (
                      <button
                        type="button"
                        onClick={() => setStatus(m.id, 'archived')}
                        disabled={busyId === m.id}
                        className={buttonClass('secondary', 'sm')}
                      >
                        Archive
                      </button>
                    )}
                    {m.status !== 'new' && (
                      <button
                        type="button"
                        onClick={() => setStatus(m.id, 'new')}
                        disabled={busyId === m.id}
                        className={buttonClass('ghost', 'sm')}
                      >
                        Mark unread
                      </button>
                    )}
                  </div>
                </PanelFooter>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

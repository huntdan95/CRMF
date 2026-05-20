'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { admin } from '@/lib/admin-client';
import { FunctionError } from '@/lib/functions-client';
import {
  listAllRescheduleRequests,
  type RescheduleRequestDoc,
} from '@/lib/admin-firestore';
import { slotLabels } from '@/lib/tours';
import { formatFriendlyDate } from '@/lib/date';
import { clsx } from '@/lib/clsx';

type Status = 'open' | 'accepted' | 'declined' | 'resolved';

const STATUS_LABEL: Record<Status, string> = {
  open: 'Open',
  accepted: 'Accepted',
  declined: 'Declined',
  resolved: 'Resolved',
};

const STATUS_CLASS: Record<Status, string> = {
  open: 'bg-[var(--color-coral)]/15 text-[var(--color-coral-dark)]',
  accepted: 'bg-[var(--color-brand-blue)]/15 text-[var(--color-brand-blue-dark)]',
  declined: 'bg-[var(--color-ink)]/10 text-[var(--color-ink-soft)]',
  resolved: 'bg-[var(--color-manatee)]/20 text-[var(--color-ink)]',
};

const FILTERS: Array<{ value: 'all' | Status; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'open', label: 'Open' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'declined', label: 'Declined' },
  { value: 'resolved', label: 'Resolved' },
];

function formatWhen(ts: RescheduleRequestDoc['createdAt']): string {
  if (!ts) return '—';
  return new Date(ts.seconds * 1000).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function ReschedulesAdmin() {
  const [rows, setRows] = useState<RescheduleRequestDoc[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | Status>('open');
  const [busyId, setBusyId] = useState<string | null>(null);

  async function refresh() {
    setError(null);
    try {
      setRows(await listAllRescheduleRequests());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load.');
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  const filtered = useMemo(() => {
    if (!rows) return null;
    return filter === 'all'
      ? rows
      : rows.filter((r) => (r.status as Status) === filter);
  }, [rows, filter]);

  async function setStatus(id: string, status: Status) {
    setBusyId(id);
    try {
      await admin.updateRescheduleRequest(id, status);
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

  const openCount =
    rows?.filter((r) => (r.status as Status) === 'open').length ?? 0;

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
                : rows?.filter((r) => (r.status as Status) === f.value).length;
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
        {openCount > 0 && (
          <p className="text-xs text-[var(--color-coral-dark)] font-medium">
            {openCount} open {openCount === 1 ? 'request' : 'requests'}
          </p>
        )}
      </div>

      {rows === null ? (
        <div className="bg-white rounded-2xl border border-[var(--color-ink)]/8 p-8 text-center text-sm text-[var(--color-ink-soft)] animate-pulse">
          Loading…
        </div>
      ) : filtered?.length === 0 ? (
        <div className="bg-[var(--color-cream)] rounded-2xl p-8 text-center text-sm text-[var(--color-ink-soft)]">
          {filter === 'open' ? 'No open requests. 🎉' : `No ${filter} requests.`}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered?.map((r) => {
            const status = r.status as Status;
            return (
              <article
                key={r.id}
                className={clsx(
                  'bg-white rounded-2xl border shadow-[var(--shadow-card)] p-5',
                  status === 'open'
                    ? 'border-[var(--color-coral)]/30 ring-1 ring-[var(--color-coral)]/15'
                    : 'border-[var(--color-ink)]/8',
                )}
              >
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">
                      {r.bookingCustomerEmail}
                    </p>
                    <p className="mt-1 text-sm text-[var(--color-ink-soft)]">
                      Currently:{' '}
                      <span className="font-medium text-[var(--color-ink)]">
                        {formatFriendlyDate(r.bookingDate)} —{' '}
                        {slotLabels[r.bookingTimeSlot as keyof typeof slotLabels] ?? r.bookingTimeSlot}
                      </span>
                    </p>
                    <p className="mt-1 text-sm">
                      Wants:{' '}
                      <span className="font-medium text-[var(--color-coral-dark)]">
                        {formatFriendlyDate(r.requestedDate)}
                        {r.requestedSlot && (
                          <> — {slotLabels[r.requestedSlot as keyof typeof slotLabels] ?? r.requestedSlot}</>
                        )}
                      </span>
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2 shrink-0">
                    <span
                      className={clsx(
                        'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium',
                        STATUS_CLASS[status],
                      )}
                    >
                      {STATUS_LABEL[status]}
                    </span>
                    <span className="text-xs text-[var(--color-ink-soft)] self-center">
                      {formatWhen(r.createdAt)}
                    </span>
                  </div>
                </div>

                {r.notes && (
                  <p className="mt-3 text-sm whitespace-pre-wrap leading-relaxed text-[var(--color-ink-soft)] bg-[var(--color-cream)] p-3 rounded-xl">
                    {r.notes}
                  </p>
                )}

                <div className="mt-4 pt-3 border-t border-[var(--color-ink)]/8 flex flex-wrap gap-2 text-xs">
                  <Link
                    href={`/admin/bookings/${r.bookingId}`}
                    className="inline-flex items-center px-3 py-1.5 rounded-full bg-[var(--color-brand-blue)] hover:bg-[var(--color-brand-blue-dark)] text-white font-medium"
                  >
                    Open booking →
                  </Link>
                  <a
                    href={`mailto:${r.bookingCustomerEmail}?subject=${encodeURIComponent('Re: reschedule request for ' + r.bookingDate)}`}
                    className="inline-flex items-center px-3 py-1.5 rounded-full border border-[var(--color-ink)]/15 hover:bg-[var(--color-ink)]/5"
                  >
                    Email customer
                  </a>
                  {status !== 'accepted' && (
                    <button
                      type="button"
                      onClick={() => setStatus(r.id, 'accepted')}
                      disabled={busyId === r.id}
                      className="inline-flex items-center px-3 py-1.5 rounded-full border border-[var(--color-ink)]/15 hover:bg-[var(--color-ink)]/5 disabled:opacity-60"
                    >
                      Mark accepted
                    </button>
                  )}
                  {status !== 'declined' && (
                    <button
                      type="button"
                      onClick={() => setStatus(r.id, 'declined')}
                      disabled={busyId === r.id}
                      className="inline-flex items-center px-3 py-1.5 rounded-full border border-[var(--color-ink)]/15 hover:bg-[var(--color-ink)]/5 disabled:opacity-60"
                    >
                      Decline
                    </button>
                  )}
                  {status !== 'resolved' && (
                    <button
                      type="button"
                      onClick={() => setStatus(r.id, 'resolved')}
                      disabled={busyId === r.id}
                      className="inline-flex items-center px-3 py-1.5 rounded-full border border-[var(--color-ink)]/15 hover:bg-[var(--color-ink)]/5 disabled:opacity-60"
                    >
                      Mark resolved
                    </button>
                  )}
                  {status !== 'open' && (
                    <button
                      type="button"
                      onClick={() => setStatus(r.id, 'open')}
                      disabled={busyId === r.id}
                      className="inline-flex items-center px-3 py-1.5 rounded-full text-[var(--color-ink-soft)] hover:bg-[var(--color-ink)]/5 disabled:opacity-60"
                    >
                      Reopen
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

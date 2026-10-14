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
import { ArrowRight, Mail } from '@/components/ui/icons';
import { Badge, DateTile, FilterTabs, PanelFooter, buttonClass, panelClass, type BadgeTone } from './ui';

type Status = 'open' | 'accepted' | 'declined' | 'resolved';

const STATUS_LABEL: Record<Status, string> = {
  open: 'Needs a reply',
  accepted: 'Moved',
  declined: 'Said no',
  resolved: 'Handled',
};

const STATUS_TONE: Record<Status, BadgeTone> = {
  open: 'buoy',
  accepted: 'spring',
  declined: 'muted',
  resolved: 'sand',
};

const FILTERS: Array<{ value: 'all' | Status; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'open', label: 'Open' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'declined', label: 'Declined' },
  { value: 'resolved', label: 'Resolved' },
];

function slotName(slot: string): string {
  return slotLabels[slot as keyof typeof slotLabels] ?? slot;
}

/** One side of the move: a date tile with what's booked or asked for. */
function When({ label, iso, slot, wanted = false }: { label: string; iso: string; slot: string | null; wanted?: boolean }) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-3 rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)]/60 p-3">
      <DateTile iso={iso} />
      <div className="min-w-0">
        <p className="text-label text-[var(--color-ink-soft)]">{label}</p>
        <p className={clsx('mt-0.5 font-semibold', wanted && 'text-[var(--color-coral-dark)]')}>
          {formatFriendlyDate(iso)}
        </p>
        {slot && <p className="text-sm text-[var(--color-ink-soft)]">{slotName(slot)}</p>}
      </div>
    </div>
  );
}

function formatWhen(ts: RescheduleRequestDoc['createdAt']): string {
  if (!ts) return '—';
  return new Date(ts.seconds * 1000).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    // Marina time, wherever Travis is reading it.
    timeZone: 'America/New_York',
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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loading on mount
    void refresh();
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
    <div className="space-y-5">
      {error && (
        <div className="rounded-2xl bg-[var(--color-coral)]/10 border border-[var(--color-coral)]/30 p-3 text-sm">
          {error}
        </div>
      )}

      <div className="flex flex-wrap gap-3 items-center justify-between">
        <FilterTabs
          label="Show requests"
          options={FILTERS.map((f) => ({
            ...f,
            count: f.value === 'all' ? rows?.length : rows?.filter((r) => (r.status as Status) === f.value).length,
          }))}
          value={filter}
          onChange={setFilter}
        />
        {openCount > 0 && (
          <Badge tone="buoy" size="md">
            {openCount} open {openCount === 1 ? 'request' : 'requests'}
          </Badge>
        )}
      </div>

      {rows === null ? (
        <div className={clsx(panelClass, 'p-8 text-center text-sm text-[var(--color-ink-soft)] animate-pulse')}>
          Loading…
        </div>
      ) : filtered?.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[var(--color-line-strong)] bg-white/50 p-8 text-center text-sm text-[var(--color-ink-soft)]">
          {filter === 'open' ? 'No open requests. 🎉' : `No ${filter} requests.`}
        </div>
      ) : (
        <div className="space-y-4">
          {filtered?.map((r) => {
            const status = r.status as Status;
            return (
              <article
                key={r.id}
                className={clsx(
                  panelClass,
                  'relative overflow-hidden',
                  // An orange edge down the left marks the ones still waiting on Travis.
                  status === 'open' &&
                    'before:absolute before:inset-y-0 before:left-0 before:w-1 before:bg-[var(--color-buoy)]',
                )}
              >
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4 border-b border-[var(--color-line)] bg-[var(--color-paper)]/70">
                  <p className="min-w-0 flex-1 basis-48 font-semibold break-all">{r.bookingCustomerEmail}</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>
                    <span className="text-xs text-[var(--color-ink-soft)] tabular-nums">{formatWhen(r.createdAt)}</span>
                  </div>
                </div>

                <div className="p-5">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
                    <When label="Booked for (when they asked)" iso={r.bookingDate} slot={r.bookingTimeSlot} />
                    <ArrowRight size={20} className="shrink-0 self-center rotate-90 text-[var(--color-ink-soft)] sm:rotate-0" />
                    <When label="Wants" iso={r.requestedDate} slot={r.requestedSlot} wanted />
                  </div>
                  {r.notes && (
                    <p className="mt-4 text-[0.9375rem] whitespace-pre-wrap leading-relaxed border-l-2 border-[var(--color-line-strong)] pl-3">
                      {r.notes}
                    </p>
                  )}
                </div>

                <PanelFooter>
                  <div className="mr-auto flex flex-wrap gap-2">
                    <Link href={`/admin/bookings/${r.bookingId}`} className={buttonClass('primary', 'sm')}>
                      Open booking to move it
                    </Link>
                    <a
                      href={`mailto:${r.bookingCustomerEmail}?subject=${encodeURIComponent('Re: reschedule request for ' + r.bookingDate)}`}
                      className={buttonClass('contact', 'sm')}
                    >
                      <Mail size={15} /> Email customer
                    </a>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {status !== 'accepted' && (
                      <button
                        type="button"
                        onClick={() => setStatus(r.id, 'accepted')}
                        disabled={busyId === r.id}
                        className={buttonClass('secondary', 'sm')}
                      >
                        I moved it
                      </button>
                    )}
                    {status !== 'declined' && (
                      <button
                        type="button"
                        onClick={() => setStatus(r.id, 'declined')}
                        disabled={busyId === r.id}
                        className={buttonClass('secondary', 'sm')}
                      >
                        I said no
                      </button>
                    )}
                    {status !== 'resolved' && (
                      <button
                        type="button"
                        onClick={() => setStatus(r.id, 'resolved')}
                        disabled={busyId === r.id}
                        className={buttonClass('secondary', 'sm')}
                      >
                        Handled another way
                      </button>
                    )}
                    {status !== 'open' && (
                      <button
                        type="button"
                        onClick={() => setStatus(r.id, 'open')}
                        disabled={busyId === r.id}
                        className={buttonClass('ghost', 'sm')}
                      >
                        Reopen
                      </button>
                    )}
                  </div>
                  {status === 'open' && (
                    <p className="basis-full text-xs text-[var(--color-ink-soft)]">
                      The buttons above only tidy up this list. To change the
                      date, open the booking and use “Move to another day or
                      tour”, which can email the customer the new time.
                    </p>
                  )}
                </PanelFooter>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

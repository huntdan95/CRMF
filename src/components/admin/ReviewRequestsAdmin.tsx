'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { admin } from '@/lib/admin-client';
import { listBlackoutsBetween, listBookingsBetween, type BlackoutDoc, type BookingDoc } from '@/lib/admin-firestore';
import { FunctionError } from '@/lib/functions-client';
import { WHOLE_DAY_OVERLAPS, marinaNow } from '@/lib/availability';
import { formatFriendlyDate } from '@/lib/date';
import { clsx } from '@/lib/clsx';
import { SLOT_MINUTES } from '@/lib/schedule';
import type { TourTimeSlot } from '@/lib/tours';
import { departureMinutes, departureTime, isLegacy, partySize, shortDate } from './booking-labels';

/*
 * Tonight's review requests. Policy (set with the owner; don't change
 * without asking): every guest whose trip ran gets the same request.
 * Travis can take out only trips that didn't run, or hold one for up to
 * 3 days to call first. There's deliberately no "don't send".
 */

type Ts = { seconds: number; nanoseconds: number } | null | undefined;

/** Bookings held from the last few days still show, so Travis can send them. */
const HELD_LOOKBACK_DAYS = 3;

function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + n)).toISOString().slice(0, 10);
}

function fullyRefunded(b: BookingDoc): boolean {
  return b.paymentStatus === 'refunded' || (b.amountPaidCents > 0 && b.amountRefundedCents >= b.amountPaidCents);
}

function at(ts: Ts, opts: Intl.DateTimeFormatOptions): string {
  if (!ts) return '';
  return new Date(ts.seconds * 1000).toLocaleString('en-US', { timeZone: 'America/New_York', ...opts });
}

/** When the evening run goes, in marina minutes (sendReviewRequests). */
const REQUESTS_AT = 19 * 60;

/**
 * Whether a blackout on the booking's date covers its departure: Travis
 * closed it, or is closing it. Same rule as closesSlot in
 * functions/src/lib/close-day.ts.
 */
function onClosedDeparture(b: BookingDoc, blackouts: readonly BlackoutDoc[]): boolean {
  return blackouts.some(
    (bo) =>
      bo.date === b.date &&
      (bo.affectedSlots.includes('all') ||
        bo.affectedSlots.includes(b.timeSlot) ||
        (b.timeSlot === 'whole-day' && bo.affectedSlots.some((s) => (WHOLE_DAY_OVERLAPS as string[]).includes(s)))),
  );
}

/**
 * `closed`, `suppressed` and `old-site` get no request, as the server
 * skips them (functions/src/postTourFollowup.ts): a trip Travis closed
 * didn't run unless he's marked it completed, a guest who marked our email
 * as spam is left out, and the old-site importer marks its bookings sent.
 * `later`: back after 7:00 (a sunset cruise), so theirs goes the next
 * morning.
 */
type RowState = 'sent' | 'didnt-sail' | 'refunded' | 'closed' | 'suppressed' | 'old-site' | 'held' | 'later' | 'due';

function stateOf(b: BookingDoc, blackouts: readonly BlackoutDoc[]): RowState {
  if (isLegacy(b) && (b as BookingDoc & { postTourFollowupMessageId?: string }).postTourFollowupMessageId === 'legacy-import') {
    return 'old-site';
  }
  if (b.postTourFollowupSentAt) return 'sent';
  if (b.status === 'no-show') return 'didnt-sail';
  if (fullyRefunded(b)) return 'refunded';
  if (b.closure || (b.status !== 'completed' && onClosedDeparture(b, blackouts))) return 'closed';
  if (b.marketingSuppressed) return 'suppressed';
  if (b.reviewHoldUntil && b.reviewHoldUntil.seconds * 1000 > Date.now()) return 'held';
  if (departureMinutes(b) + (SLOT_MINUTES[b.timeSlot as TourTimeSlot] ?? 120) > REQUESTS_AT) return 'later';
  return 'due';
}

export function ReviewRequestsAdmin() {
  const [rows, setRows] = useState<BookingDoc[] | null>(null);
  const [blackouts, setBlackouts] = useState<BlackoutDoc[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  // What Send now or Didn't sail did to a row held from an earlier trip.
  // Those rows are listed only while held, so the action takes the row (and
  // with the last one, its section) away: focus comes here, where it says
  // what happened, instead of falling to the page. A new object each time,
  // so the same words twice still move focus.
  const [done, setDone] = useState<{ text: string } | null>(null);
  const doneRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (done) doneRef.current?.focus();
  }, [done]);
  const today = marinaNow().date;

  const load = useCallback(async () => {
    try {
      const from = addDays(today, -HELD_LOOKBACK_DAYS);
      const [all, closed] = await Promise.all([listBookingsBetween(from, today), listBlackoutsBetween(from, today)]);
      setBlackouts(closed);
      setRows(
        all.filter(
          (b) =>
            (b.status === 'confirmed' ||
              b.status === 'completed' ||
              b.status === 'no-show' ||
              // Old-site bookings held with a deposit: real guests.
              (b.status === 'pending-payment' && b.id.startsWith('legacy-'))) &&
            (b.date === today || stateOf(b, closed) === 'held'),
        ),
      );
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Couldn’t load today’s trips.');
    }
  }, [today]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load
    load();
  }, [load]);

  if (rows === null && !loadError) {
    return (
      <div className="bg-white rounded-2xl border border-[var(--color-ink)]/8 p-6 text-center text-sm text-[var(--color-ink-soft)] animate-pulse">
        Loading today’s trips…
      </div>
    );
  }

  const todays = (rows ?? []).filter((b) => b.date === today);
  const earlier = (rows ?? []).filter((b) => b.date !== today);
  const departures = [...new Set(todays.map((b) => b.timeSlot))]
    .map((slot) => todays.filter((b) => b.timeSlot === slot))
    .sort((a, b) => departureMinutes(a[0]!) - departureMinutes(b[0]!));
  const goingTonight = todays.filter((b) => stateOf(b, blackouts) === 'due').length;
  const goingTomorrow = todays.filter((b) => stateOf(b, blackouts) === 'later').length;

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-[var(--color-brand-blue)]/20 bg-[var(--color-brand-blue)]/8 p-4 text-sm space-y-2">
        <p>
          <strong>Every guest whose trip ran gets the same thank-you email with your Google review link</strong>,
          at 7:00 tonight. You don’t need to do anything for that.
        </p>
        <p>
          <strong>Didn’t sail</strong> is only for guests who didn’t go out; they get no request.{' '}
          <strong>Hold</strong> lets you call someone first. Their request still goes out on
          its own after 3 days, or when you tap Send now.
        </p>
        <p className="text-[var(--color-ink-soft)]">
          Asking only the happy guests is against Google’s rules, and Google can remove
          reviews for it, so there’s no way to skip someone whose trip ran.
        </p>
      </section>

      {loadError && (
        <p role="alert" className="rounded-2xl bg-[var(--color-coral)]/10 border border-[var(--color-coral)]/30 p-3 text-sm">
          {loadError}
        </p>
      )}

      {rows && (
        <p className="text-sm font-medium">
          {todays.length === 0
            ? 'No trips today.'
            : `${goingTonight} ${goingTonight === 1 ? 'request goes' : 'requests go'} out at 7:00 tonight.${
                goingTomorrow ? ` ${goingTomorrow} more tomorrow morning (back after 7:00).` : ''
              }`}
        </p>
      )}

      {done && (
        <p
          ref={doneRef}
          role="status"
          tabIndex={-1}
          className="rounded-2xl bg-[var(--color-mist)] border border-[var(--color-spring)]/30 p-3 text-sm outline-none"
        >
          {done.text}
        </p>
      )}

      {departures.map((list) => (
        <section
          key={list[0]!.timeSlot}
          className="bg-white rounded-2xl border border-[var(--color-ink)]/8 shadow-[var(--shadow-card)]"
        >
          <h2 className="px-5 pt-4 pb-2 font-display text-lg">
            {departureTime(list[0]!)} · {list[0]!.tourName}
          </h2>
          <ul className="divide-y divide-[var(--color-ink)]/8 border-t border-[var(--color-ink)]/8">
            {list.map((b) => (
              <ReviewRow key={b.id} booking={b} state={stateOf(b, blackouts)} onChanged={load} />
            ))}
          </ul>
        </section>
      ))}

      {earlier.length > 0 && (
        <section className="bg-white rounded-2xl border border-[var(--color-ink)]/8 shadow-[var(--shadow-card)]">
          <h2 className="px-5 pt-4 pb-2 font-display text-lg">Held from earlier trips</h2>
          <ul className="divide-y divide-[var(--color-ink)]/8 border-t border-[var(--color-ink)]/8">
            {earlier.map((b) => (
              <ReviewRow
                key={b.id}
                booking={b}
                state={stateOf(b, blackouts)}
                onChanged={load}
                onGone={(text) => setDone({ text })}
                showDate
              />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

const STATE_PILL: Record<RowState, string> = {
  sent: 'bg-[var(--color-manatee)]/20 text-[var(--color-ink)]',
  'didnt-sail': 'bg-[var(--color-ink)]/10 text-[var(--color-ink-soft)]',
  refunded: 'bg-[var(--color-ink)]/10 text-[var(--color-ink-soft)]',
  closed: 'bg-[var(--color-ink)]/10 text-[var(--color-ink-soft)]',
  suppressed: 'bg-[var(--color-ink)]/10 text-[var(--color-ink-soft)]',
  'old-site': 'bg-[var(--color-ink)]/10 text-[var(--color-ink-soft)]',
  held: 'bg-[var(--color-coral)]/15 text-[var(--color-coral-dark)]',
  later: 'bg-[var(--color-brand-blue)]/15 text-[var(--color-brand-blue-dark)]',
  due: 'bg-[var(--color-brand-blue)]/15 text-[var(--color-brand-blue-dark)]',
};

function ReviewRow({
  booking: b,
  state,
  onChanged,
  onGone,
  showDate,
}: {
  booking: BookingDoc;
  state: RowState;
  onChanged: () => Promise<void>;
  /** A row that leaves the list once acted on: says what happened, page-level. */
  onGone?: (text: string) => void;
  showDate?: boolean;
}) {
  const [busy, setBusy] = useState<'send' | 'hold' | 'no-show' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pillRef = useRef<HTMLSpanElement>(null);
  /** Set when an action went through, until the row shows its new state. */
  const acted = useRef(false);
  const firstName = b.customerName.split(' ')[0] || b.customerName;
  const phone = b.customerPhone?.replace(/[^\d+]/g, '');

  // Send now, Hold and Didn't sail take their buttons away: focus goes to
  // the row's new status instead of to the page.
  useEffect(() => {
    if (!acted.current) return;
    acted.current = false;
    pillRef.current?.focus();
  }, [state]);

  const pill: Record<RowState, string> = {
    sent: `Sent ${at(b.postTourFollowupSentAt, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}`,
    'didnt-sail': 'Didn’t sail: no request',
    refunded: 'Refunded: no request',
    closed: 'Trip closed: no request',
    suppressed: 'Marked our email as spam: no request',
    'old-site': 'Old-site booking: no request',
    held: `Held: sends ${at(b.reviewHoldUntil, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}`,
    later: 'Goes out tomorrow morning',
    due: 'Goes out at 7:00 PM',
  };

  async function run(kind: 'send' | 'hold' | 'no-show') {
    if (kind === 'send' && !confirm(`Send ${firstName} the thank-you email with the review link now?`)) return;
    if (
      kind === 'no-show' &&
      !confirm(
        `${b.customerName} didn’t go out on the boat?\n\nThey’re marked a no-show and won’t get a review request. Nothing is refunded and nobody is emailed. This can’t be undone.`,
      )
    ) {
      return;
    }
    setBusy(kind);
    setError(null);
    try {
      if (kind === 'no-show') await admin.markBooking(b.id, 'no-show');
      else await admin.reviewRequest(b.id, kind);
      // A row held from an earlier trip is no longer held, so the reload
      // takes it away: there's no pill left to move focus to, and the page
      // says what happened instead.
      const gone = !!onGone && kind !== 'hold';
      acted.current = !gone;
      await onChanged();
      if (gone) {
        onGone?.(
          kind === 'send'
            ? `Sent ${b.customerName || 'them'} the thank-you email with your review link.`
            : `${b.customerName || 'That guest'} is marked as didn’t sail: no review request.`,
        );
      }
    } catch (err) {
      setError(err instanceof FunctionError ? err.message : 'That didn’t work. Try again in a minute.');
    } finally {
      setBusy(null);
    }
  }

  const canAct = state === 'due' || state === 'later' || state === 'held';

  return (
    <li className="px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <Link href={`/admin/bookings/${b.id}`} className="font-semibold underline-offset-4 hover:underline">
            {b.customerName || 'No name given'}
          </Link>
          <p className="text-sm text-[var(--color-ink-soft)]">
            {showDate && `${shortDate(b.date)} · ${departureTime(b)} · `}
            {partySize(b)}
            {b.customerPhone && (
              <>
                {' · '}
                <a href={`tel:${phone}`} className="text-[var(--color-brand-blue)] underline underline-offset-4">
                  {b.customerPhone}
                </a>
              </>
            )}
          </p>
        </div>
        <span
          ref={pillRef}
          tabIndex={-1}
          className={clsx('inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium outline-none', STATE_PILL[state])}
        >
          {pill[state]}
        </span>
      </div>

      {canAct && (
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <ActionButton onClick={() => run('send')} busy={busy === 'send'} disabled={busy !== null}>
            Send now
          </ActionButton>
          {(state === 'due' || state === 'later') && (
            <ActionButton onClick={() => run('hold')} busy={busy === 'hold'} disabled={busy !== null}>
              Hold, I’ll call them first
            </ActionButton>
          )}
          {b.status === 'confirmed' && (
            <ActionButton onClick={() => run('no-show')} busy={busy === 'no-show'} disabled={busy !== null} tone="quiet">
              Didn’t sail
            </ActionButton>
          )}
        </div>
      )}
      {state === 'held' && showDate && (
        <p className="mt-2 text-xs text-[var(--color-ink-soft)]">Trip on {formatFriendlyDate(b.date)}.</p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-[var(--color-coral-dark)]">
          {error}
        </p>
      )}
    </li>
  );
}

function ActionButton({
  children,
  onClick,
  busy,
  disabled,
  tone = 'default',
}: {
  children: React.ReactNode;
  onClick: () => void;
  busy: boolean;
  disabled: boolean;
  tone?: 'default' | 'quiet';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={clsx(
        'inline-flex items-center justify-center min-h-11 px-4 py-2 rounded-[10px] text-sm font-medium disabled:opacity-60',
        tone === 'quiet'
          ? 'border border-[var(--color-ink)]/15 text-[var(--color-ink-soft)] hover:bg-[var(--color-ink)]/5'
          : 'border border-[var(--color-brand-blue)]/30 text-[var(--color-brand-blue)] hover:bg-[var(--color-brand-blue)]/5',
      )}
    >
      {busy ? 'Saving…' : children}
    </button>
  );
}

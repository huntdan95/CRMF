'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { admin } from '@/lib/admin-client';
import { FunctionError } from '@/lib/functions-client';
import { subscribePendingClosures } from '@/lib/admin-firestore';
import type { ClosureActionDoc } from '@/lib/closure-types';
import { clsx } from '@/lib/clsx';
import { backOnLines, closureSummary, dayMedium, joinTimes, reopenedLead } from './closure-summary';
import { buttonClass } from './ui';

const CHOICE_TEXT: Record<ClosureActionDoc['choice'], string> = {
  offer: 'emailing them to pick a new date or a refund',
  cancel: 'cancelling and refunding them',
  keep: 'leaving them booked and telling the crew',
};

/**
 * "6 guests in 2 bookings". Old-site bookings with no party size on file
 * aren't in the count, so as in the crew app it's "4+ guests", or just the
 * bookings when no party size is known. A closure confirmed before
 * `unknown` was recorded has the plain count.
 */
function whoText(summary: ClosureActionDoc['summary'] | undefined): string {
  const bookings = summary?.bookings ?? 0;
  const guests = summary?.guests ?? 0;
  const unknown = summary?.unknown ?? 0;
  const inBookings = `${bookings} ${bookings === 1 ? 'booking' : 'bookings'}`;
  if (unknown === 0) return `${guests} ${guests === 1 ? 'guest' : 'guests'} in ${inBookings}`;
  return guests > 0 ? `${guests}+ guests in ${inBookings}` : `${inBookings} (party size unknown)`;
}

/** "9:41" */
function clock(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Closed days still in their undo window, with a countdown, Undo and Send
 * now. Shown on the dashboard and on Close a day. Nothing has been sent
 * for these yet; the trips are only blocked to new bookings.
 *
 * `onChange` gets the closed day's id once it has gone out or been undone,
 * whether from these buttons or not (the scheduler at the end of the
 * window, another tab), so the page around it can catch up.
 */
export function PendingClosuresBanner({ onChange }: { onChange?: (blackoutId: string) => void }) {
  const [actions, setActions] = useState<ClosureActionDoc[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, { kind: 'ok' | 'err'; lines: string[] }>>({});
  // The latest onChange for the listener below, and what it showed last.
  const changed = useRef(onChange);
  const shown = useRef<Set<string>>(new Set());
  useEffect(() => {
    changed.current = onChange;
  });

  useEffect(
    () =>
      subscribePendingClosures(
        (list) => {
          setLoadFailed(false);
          setActions(list);
          const ids = new Set(list.map((a) => a.id));
          for (const id of shown.current) if (!ids.has(id)) changed.current?.(id);
          shown.current = ids;
        },
        () => setLoadFailed(true),
      ),
    [],
  );

  useEffect(() => {
    if (actions.length === 0) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [actions.length]);

  async function undo(a: ClosureActionDoc) {
    setBusy(a.id);
    try {
      const r = await admin.undoClosure(a.id);
      // Someone an earlier closing of these trips offered a new date can be
      // back on their trip now. Unless another closing of that day still
      // covers them, which keeps them closed (`stillClosed`).
      setMessages((m) => ({
        ...m,
        [a.id]: { kind: 'ok', lines: [reopenedLead(dayMedium(a.date), 'undo', r.stillClosed), ...backOnLines(r)] },
      }));
      onChange?.(a.id);
    } catch (err) {
      setMessages((m) => ({
        ...m,
        [a.id]: { kind: 'err', lines: [err instanceof FunctionError ? err.message : 'That didn’t go through. Check your signal and try again.'] },
      }));
    } finally {
      setBusy(null);
    }
  }

  async function sendNow(a: ClosureActionDoc) {
    setBusy(a.id);
    try {
      const r = await admin.sendClosureNow(a.id);
      const { summary, problems } = closureSummary(a.choice, r.result);
      setMessages((m) => ({
        ...m,
        [a.id]: {
          kind: problems.length ? 'err' : 'ok',
          lines: [`Sent. ${dayMedium(a.date)} is closed.`, ...summary, ...problems],
        },
      }));
      onChange?.(a.id);
    } catch (err) {
      setMessages((m) => ({
        ...m,
        [a.id]: { kind: 'err', lines: [err instanceof FunctionError ? err.message : 'That didn’t go through. Check your signal and try again.'] },
      }));
    } finally {
      setBusy(null);
    }
  }

  const done = Object.entries(messages).filter(([id]) => !actions.some((a) => a.id === id));

  if (actions.length === 0 && done.length === 0) {
    return loadFailed ? (
      <div role="alert" className="mb-6 rounded-2xl bg-[var(--color-coral)]/10 border border-[var(--color-coral)]/30 p-3 text-sm">
        Couldn’t check for days you’re closing. Reload the page to see the Undo button if you just closed one.
      </div>
    ) : null;
  }

  return (
    <div className="mb-6 space-y-3" aria-live="polite">
      {actions.map((a) => {
        const left = (a.finalizeAt.seconds * 1000 - now) / 1000;
        const sending = a.state === 'finalizing' || left <= 0;
        const msg = messages[a.id];
        const times = a.summary?.departs ?? [];
        return (
          <section
            key={a.id}
            className="rounded-2xl border-2 border-[var(--color-coral)] bg-white shadow-[var(--shadow-panel)] overflow-hidden"
          >
            <div className="flex items-center gap-4 px-4 py-3.5 sm:px-5">
              <div
                className={clsx(
                  'flex h-14 w-16 shrink-0 flex-col items-center justify-center rounded-xl',
                  sending ? 'bg-[var(--color-ink)]/10 text-[var(--color-ink-soft)]' : 'bg-[var(--color-coral)] text-white',
                )}
                aria-hidden
              >
                <span className="font-display text-lg font-bold leading-none tabular-nums">{sending ? '…' : clock(left)}</span>
                <span className="mt-1 text-[0.6rem] font-semibold uppercase tracking-[0.14em]">{sending ? 'sending' : 'to undo'}</span>
              </div>
              <div className="min-w-0 flex-1 text-sm">
                <p className="font-semibold text-base leading-tight">
                  Closing {dayMedium(a.date)}
                  {times.length > 0 && `: ${joinTimes(times)}`}
                </p>
                <p className="mt-1 text-[var(--color-ink-soft)]">
                  {sending
                    ? 'Going out now. Nobody can book these trips.'
                    : `Blocked to new bookings. Nothing has been sent yet. In ${clock(left)}: ${whoText(a.summary)}, ${CHOICE_TEXT[a.choice]}.`}
                </p>
              </div>
            </div>
            {!sending && (
              <div className="flex flex-col-reverse gap-2 border-t border-[var(--color-line)] bg-[var(--color-paper)]/70 px-4 py-3 sm:flex-row sm:justify-end sm:px-5">
                <button
                  type="button"
                  onClick={() => sendNow(a)}
                  disabled={busy === a.id}
                  className={clsx(buttonClass('secondary'), 'w-full sm:w-auto')}
                >
                  Send now
                </button>
                <button
                  type="button"
                  onClick={() => undo(a)}
                  disabled={busy === a.id}
                  className={clsx(buttonClass('primary'), 'w-full sm:w-auto min-h-12 text-base')}
                >
                  {busy === a.id ? 'Working…' : 'Undo'}
                </button>
              </div>
            )}
            {msg && (
              <p role="alert" className="border-t border-[var(--color-line)] px-4 py-3 text-sm sm:px-5">
                {msg.lines.join(' ')}
              </p>
            )}
          </section>
        );
      })}
      {done.map(([id, msg]) => (
        <div
          key={id}
          role="status"
          className={clsx(
            'rounded-2xl border p-3 text-sm space-y-1',
            msg.kind === 'ok'
              ? 'bg-[var(--color-mist)] border-[var(--color-spring)]/30'
              : 'bg-[var(--color-coral)]/10 border-[var(--color-coral)]/30',
          )}
        >
          {msg.lines.map((line) => (
            <p key={line}>{line}</p>
          ))}
          <button
            type="button"
            onClick={() => setMessages((m) => Object.fromEntries(Object.entries(m).filter(([k]) => k !== id)))}
            className="text-sm font-semibold underline underline-offset-4 min-h-11"
          >
            OK
          </button>
        </div>
      ))}
    </div>
  );
}

/**
 * The dashboard's banner. Today and Tomorrow below it are rendered on the
 * server, so a closing that goes out or is undone reloads them: otherwise
 * they'd still say the undo is open.
 */
export function DashboardClosuresBanner() {
  const router = useRouter();
  return <PendingClosuresBanner onChange={() => router.refresh()} />;
}

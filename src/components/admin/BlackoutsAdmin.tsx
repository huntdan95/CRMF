'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { admin } from '@/lib/admin-client';
import { FunctionError } from '@/lib/functions-client';
import {
  getClosureAction,
  listAllBlackouts,
  listBlackoutsBetween,
  listBookingsBetween,
  subscribePendingClosures,
  type BlackoutDoc,
  type BookingDoc,
} from '@/lib/admin-firestore';
import type { BookingOutcome, ClosureActionDoc, ClosureChoice, ClosurePreview } from '@/lib/closure-types';
import { WHOLE_DAY_OVERLAPS, addDaysIso, marinaNow } from '@/lib/availability';
import { departureTimes, formatPrice, slotLabels, slotOrder, tours, type TourTimeSlot } from '@/lib/tours';
import { slotRunsOn, slotStartMinutes } from '@/lib/schedule';
import { formatFriendlyDate, isValidIsoDate } from '@/lib/date';
import { clsx } from '@/lib/clsx';
import { PendingClosuresBanner } from './PendingClosuresBanner';
import { backOnLines, closureSummary, dayMedium, dayShort, joinTimes } from './closure-summary';
import {
  Badge,
  DateTile,
  PanelBody,
  PanelFooter,
  PanelHeader,
  TimeTile,
  buttonClass,
  hintClass,
  inputClass,
  labelClass,
  panelClass,
} from './ui';

const REASON_OPTIONS = [
  { value: 'weather', label: 'Weather' },
  { value: 'maintenance', label: 'Boat maintenance' },
  { value: 'personal', label: 'Personal' },
  { value: 'other', label: 'Other' },
] as const;
export type Reason = (typeof REASON_OPTIONS)[number]['value'];

/**
 * Every departure Travis can close, in time order. Times need the date:
 * the sunset cruise's moves with the sun (src/lib/schedule.ts).
 */
const DEPARTURES: Array<{
  slot: TourTimeSlot;
  label: string;
  time: (date: string) => string;
  startMinutes: (date: string) => number;
}> = [...slotOrder, 'whole-day' as const, 'sunset' as const].map((slot) => {
  const tour = tours.find((t) => t.timeSlot === slot);
  return {
    slot,
    label: slot === 'whole-day'
      ? 'All-day private charter'
      : slot === 'sunset'
        ? 'Sunset cruise (before sunset)'
        : `${slotLabels[slot]}${tour ? ` (${tour.startTimeDisplay})` : ''}`,
    // Until the date is a real one, the cruise has no time to show.
    time: (date) =>
      !isValidIsoDate(date) && slot === 'sunset' ? 'Sunset' : tour ? departureTimes(tour, isValidIsoDate(date) ? date : null).start : '',
    startMinutes: (date) => (isValidIsoDate(date) ? slotStartMinutes(slot, date) : 0),
  };
});

/** Same rule as the server: closing a slot the charter runs through also closes the charter. */
function affects(slot: string, closed: string[]): boolean {
  if (closed.includes('all') || closed.includes(slot)) return true;
  return slot === 'whole-day' && closed.some((s) => (WHOLE_DAY_OVERLAPS as string[]).includes(s));
}

/** Dates further out than this get the "Forecasts change" warning. Same as FAR_AHEAD_DAYS on the server. */
const FAR_AHEAD_DAYS = 3;

const isActive = (b: BookingDoc) => b.status === 'confirmed' || b.status === 'pending-payment';

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

type Step =
  | { kind: 'form' }
  | { kind: 'review'; preview: ClosurePreview; notice?: string }
  | {
      kind: 'done';
      date: string;
      summary: string[];
      problems: string[];
      pending: boolean;
      /** Instead of "Blocked. Sending soon" or "Done". */
      title?: string;
      /** Still to hear how it went: waiting out the undo window, or going out. */
      blackoutId?: string;
    };

export function BlackoutsAdmin({ initialDate, initialReason }: { initialDate?: string; initialReason?: Reason }) {
  const [list, setList] = useState<BlackoutDoc[] | null>(null);
  const [pending, setPending] = useState<ClosureActionDoc[]>([]);
  const [showPast, setShowPast] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Marina date: the server renders this in UTC, the browser wherever it is.
  const now = marinaNow();
  const today = now.date;

  const [date, setDate] = useState(initialDate && isValidIsoDate(initialDate) && initialDate >= today ? initialDate : today);
  const [wholeDay, setWholeDay] = useState(true);
  const [slots, setSlots] = useState<Set<TourTimeSlot>>(new Set());
  const [reason, setReason] = useState<Reason>(initialReason ?? 'weather');
  const [notes, setNotes] = useState('');
  const [farAheadOk, setFarAheadOk] = useState(false);
  // Who's booked on the chosen date, for the picker.
  const [day, setDay] = useState<{ date: string; bookings: BookingDoc[]; blackouts: BlackoutDoc[] } | null>(null);
  const [dayError, setDayError] = useState(false);

  // No default: Travis has to say what happens to people already booked.
  const [choice, setChoice] = useState<ClosureChoice | null>(null);
  const [typed, setTyped] = useState('');
  const [previewFor, setPreviewFor] = useState<string | null>(null);
  const [step, setStep] = useState<Step>({ kind: 'form' });
  const [busy, setBusy] = useState(false);

  async function refresh() {
    try {
      setList(await listAllBlackouts());
    } catch {
      setError('Couldn’t load your closed days. Check your signal and reload the page.');
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loading on mount
    void refresh();
    return subscribePendingClosures(setPending, () => undefined);
  }, []);

  useEffect(() => {
    if (!isValidIsoDate(date)) return;
    let stale = false;
    Promise.all([listBookingsBetween(date, date), listBlackoutsBetween(date, date)])
      .then(([bookings, blackouts]) => {
        if (stale) return;
        setDayError(false);
        setDay({ date, bookings: bookings.filter(isActive), blackouts });
      })
      .catch(() => {
        if (!stale) setDayError(true);
      });
    return () => {
      stale = true;
    };
  }, [date]);

  const dateOk = isValidIsoDate(date) && date >= today;
  const farAhead = dateOk && date > addDaysIso(today, FAR_AHEAD_DAYS);
  const started = (startMinutes: number) => date < today || (date === today && now.minutes >= startMinutes);
  // The whole-day shortcut can't take back trips that have already gone out.
  const someLeft = DEPARTURES.some((d) => d.slot !== 'whole-day' && started(d.startMinutes(date)));
  const useWhole = wholeDay && !someLeft;
  const picked = DEPARTURES.filter((d) => slots.has(d.slot) && !started(d.startMinutes(date))).map((d) => d.slot);
  const closed: Array<TourTimeSlot | 'all'> = useWhole ? ['all'] : picked;
  const dayInfo = day?.date === date ? day : null;

  function pickDate(v: string) {
    setDate(v);
    setFarAheadOk(false);
    setSlots(new Set());
    setDay(null);
  }

  function toggleSlot(s: TourTimeSlot) {
    setSlots((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  }

  async function review(notice?: string) {
    setError(null);
    if (!dateOk) {
      setError('Pick today or a day ahead. A day that’s passed can’t be closed.');
      return;
    }
    if (closed.length === 0) {
      setError(someLeft && wholeDay ? 'Some trips have left already. Pick the ones still to go.' : 'Pick at least one trip to close, or choose “All trips that day”.');
      return;
    }
    if (farAhead && !farAheadOk) {
      setError('Tap “Yes, close it this far ahead” first.');
      return;
    }
    setBusy(true);
    try {
      const preview = await admin.previewClosure({ date, affectedSlots: closed, reason, notes: notes.trim() || undefined });
      setChoice(preview.bookings.length === 0 ? 'keep' : null);
      setTyped('');
      setPreviewFor(preview.bookings.find((b) => b.hasEmail)?.id ?? null);
      setStep({ kind: 'review', preview, notice });
    } catch (err) {
      setStep({ kind: 'form' });
      setError(err instanceof FunctionError ? err.message : 'Couldn’t check who’s booked that day. Check your signal and try again.');
    } finally {
      setBusy(false);
    }
  }

  async function confirm(preview: ClosurePreview) {
    if (!choice) return;
    const token = preview.choices[choice]?.confirmToken;
    if (!token) return;
    setError(null);
    setBusy(true);
    try {
      const r = await admin.confirmClosure({ confirmToken: token, choice, confirmText: typed });
      const what = closed.includes('all') ? 'the whole day' : joinTimes(preview.departures.map((d) => d.departs));
      // Waiting out the undo window. With no window (0 in Settings) it has
      // already gone out: `pending` then means someone paid as they were
      // being cancelled and is being tried again, and the rest is done.
      if (r.state === 'pending' && r.finalizeAt && !r.result) {
        setStep({
          kind: 'done',
          date: preview.date,
          pending: true,
          blackoutId: r.blackoutId,
          summary: [
            `${dayMedium(preview.date)} (${what}) is blocked. Nobody can book it online now.`,
            `Nothing has been sent and no booking has changed yet. That happens in ${plural(preview.undoMinutes, 'minute')}. Until then you can undo it from the banner above.`,
          ],
          problems: [],
        });
      } else {
        const { summary, problems } = closureSummary(choice, r.result ?? { cancelled: [], offered: [], failed: [] });
        setStep({
          kind: 'done',
          date: preview.date,
          pending: false,
          summary: [
            `${dayMedium(preview.date)} is closed (${what}). Nobody can book it online now.`,
            ...summary,
            ...(r.state === 'pending' ? ['Some of it is still going through. The banner above shows it until it’s finished.'] : []),
          ],
          problems,
        });
      }
      setNotes('');
      await refresh();
    } catch (err) {
      const code = err instanceof FunctionError && err.body && typeof err.body === 'object' ? (err.body as { code?: string }).code : undefined;
      if (code === 'stale' || code === 'expired') {
        // Back to the review, with things as they are now.
        await review(`${(err as FunctionError).message} Here’s how it stands now.`);
        return;
      }
      setError(
        err instanceof FunctionError
          ? err.message
          : 'We lost the connection. Check the list of closed days below before trying again: it may have gone through.',
      );
    } finally {
      setBusy(false);
    }
  }

  /**
   * The banner says a closing went out or was undone. If it's the one the
   * step above is waiting on, show how it went: it can't keep saying that
   * nothing has been sent.
   */
  async function closureChanged(id: string) {
    void refresh();
    if (step.kind !== 'done' || step.blackoutId !== id) return;
    // Couldn't read it: says to check the list instead.
    const action = await getClosureAction(id).catch(() => null);
    setStep((s) => {
      if (s.kind !== 'done' || s.blackoutId !== id) return s;
      const closedLine = `${dayMedium(s.date)} is closed. Nobody can book it online now.`;
      switch (action?.state) {
        case 'pending':
          return s;
        case 'finalizing':
          // Someone paid as they were being cancelled: the banner shows it until it's finished.
          return { ...s, pending: false, title: 'Going out now', summary: [closedLine, 'It’s going out now. The banner above shows it until it’s finished.'], problems: [] };
        case 'undone':
          return { kind: 'done', date: s.date, pending: false, title: 'Undone', summary: [`Undone. ${dayMedium(s.date)} is open for booking again, and nobody was told anything.`], problems: [] };
        case 'done': {
          const { summary, problems } = closureSummary(action.choice, action.result ?? { cancelled: [], offered: [], failed: [] });
          return { kind: 'done', date: s.date, pending: false, summary: [closedLine, ...summary], problems };
        }
        default:
          return { kind: 'done', date: s.date, pending: false, summary: [`The undo time for ${dayMedium(s.date)} is over. Check the closed days below to see where it stands.`], problems: [] };
      }
    });
  }

  async function reopen(b: BlackoutDoc) {
    const waiting = pending.find((p) => p.id === b.id && p.state === 'pending');
    const message = waiting
      ? `Undo closing ${formatFriendlyDate(b.date)}?\n\nNothing has been sent yet, so this closing hasn’t changed anyone’s booking. Anyone an earlier closing of these trips left choosing a new date goes back on their trip, unless it has already left or another closed day still covers it.`
      : `Reopen ${formatFriendlyDate(b.date)} for booking?\n\nBookings that were cancelled stay cancelled. Anyone you offered a new date who hasn’t moved or taken a refund goes back on their trip, unless it has already left. They aren’t emailed, so let them know it’s going ahead. If the crew were told those trips were off, they get a message that they’re back on.`;
    if (!confirm_(message)) return;
    setNotice(null);
    try {
      const r = await admin.deleteBlackout(b.id);
      // Who's back on their trip, and whether the crew heard, including on
      // a day left booked, where nobody is put back but the crew were told
      // it was closed.
      const lines = backOnLines(r);
      // The server always says who it put back. Without that it's the old
      // version, which only takes the blackout down.
      if (!r.undone && r.restored === undefined) {
        lines.push(
          'The server hasn’t been updated yet, so anyone you offered a new date wasn’t put back on their trip and still shows as choosing. Call or text them that it’s going ahead.',
        );
      }
      if (lines.length) setNotice(lines.join(' '));
      await refresh();
    } catch (err) {
      setError(err instanceof FunctionError ? err.message : 'That didn’t go through. Try again in a minute.');
    }
  }

  const upcoming = (list ?? []).filter((b) => b.date >= today);
  const past = (list ?? []).filter((b) => b.date < today).reverse();

  return (
    <div className="space-y-6">
      <PendingClosuresBanner onChange={(id) => void closureChanged(id)} />

      {error && (
        <div role="alert" className="rounded-2xl bg-[var(--color-coral)]/10 border border-[var(--color-coral)]/30 p-3 text-sm">
          {error}
        </div>
      )}
      {notice && (
        <div role="status" className="rounded-2xl bg-[var(--color-buoy)]/15 border border-[var(--color-buoy)]/40 p-3 text-sm">
          {notice}
        </div>
      )}

      <section className={clsx(panelClass, 'overflow-hidden')}>
        {step.kind === 'form' && (
          <>
            <PanelHeader title="Close a day" />
            <PanelBody className="space-y-5">
              <div className="grid sm:grid-cols-2 gap-4">
                <label className="block">
                  <span className={labelClass}>Date</span>
                  <input type="date" value={date} min={today} onChange={(e) => pickDate(e.target.value)} className={inputClass} />
                  {isValidIsoDate(date) && <span className={hintClass}>{formatFriendlyDate(date)}</span>}
                </label>
                <label className="block">
                  <span className={labelClass}>Why</span>
                  <select value={reason} onChange={(e) => setReason(e.target.value as Reason)} className={inputClass}>
                    {REASON_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </label>
              </div>

              {isValidIsoDate(date) && date < today && (
                <p role="alert" className="rounded-xl bg-[var(--color-coral)]/10 border border-[var(--color-coral)]/30 p-3 text-sm">
                  That day has passed. Pick today or a day ahead.
                </p>
              )}

              {farAhead && (
                <div role="alert" className="rounded-xl bg-[var(--color-buoy)]/12 border border-[var(--color-buoy)]/40 p-3.5 text-sm">
                  <p className="font-semibold">Forecasts change. Cancel this far ahead?</p>
                  <p className="mt-1 text-[var(--color-ink-soft)]">
                    {formatFriendlyDate(date)} is more than {FAR_AHEAD_DAYS} days away.
                  </p>
                  <button
                    type="button"
                    aria-pressed={farAheadOk}
                    onClick={() => setFarAheadOk((v) => !v)}
                    className={clsx(buttonClass(farAheadOk ? 'primary' : 'secondary'), 'mt-3 w-full sm:w-auto')}
                  >
                    {farAheadOk ? '✓ Yes, close it this far ahead' : 'Yes, close it this far ahead'}
                  </button>
                </div>
              )}

              {dateOk && (
                <fieldset>
                  <legend className={labelClass}>Which trips</legend>
                  <TripRow
                    checked={useWhole}
                    disabled={someLeft}
                    onChange={() => setWholeDay(true)}
                    type="radio"
                    title="All trips that day"
                    detail={
                      someLeft
                        ? 'Some trips have left already. Pick the ones still to go.'
                        : dayInfo
                          ? dayInfo.bookings.length === 0
                            ? 'Nobody is booked that day'
                            : `${plural(dayInfo.bookings.length, 'booking')} · ${plural(dayInfo.bookings.reduce((s, b) => s + b.guestCount, 0), 'guest')}`
                          : undefined
                    }
                  />
                  <TripRow
                    checked={!useWhole}
                    onChange={() => setWholeDay(false)}
                    type="radio"
                    title="Only some trips"
                  />
                  {!useWhole && (
                    <div className="mt-3 space-y-2">
                      {dayError && <p className="text-sm text-[var(--color-coral-dark)]">Couldn’t load who’s booked. Check your signal.</p>}
                      {/* The sunset cruise only runs in its season, but an old-site booking can be on it out of season. */}
                      {DEPARTURES.filter(
                        (d) => !dateOk || slotRunsOn(d.slot, date) || (dayInfo?.bookings ?? []).some((b) => b.timeSlot === d.slot),
                      ).map((d) => {
                        const gone = started(d.startMinutes(date));
                        const on = (dayInfo?.bookings ?? []).filter((b) => b.timeSlot === d.slot);
                        const guests = on.reduce((s, b) => s + b.guestCount, 0);
                        const blocked = (dayInfo?.blackouts ?? []).some((bo) => affects(d.slot, bo.affectedSlots));
                        const type = on[0]?.type === 'private' ? 'Private' : on.length ? 'Shared' : null;
                        return (
                          <TripRow
                            key={d.slot}
                            type="checkbox"
                            checked={slots.has(d.slot) && !gone}
                            disabled={gone}
                            onChange={() => toggleSlot(d.slot)}
                            time={d.time(date)}
                            muted={gone || on.length === 0}
                            title={d.slot === 'whole-day' ? 'All-day private charter' : slotLabels[d.slot]}
                            detail={
                              gone
                                ? 'Already left'
                                : !dayInfo
                                  ? 'Checking…'
                                  : on.length === 0
                                    ? `Nobody booked${blocked ? ' · already closed' : ''}`
                                    : `${type} · ${plural(on.length, 'booking')} · ${guests ? plural(guests, 'guest') : 'party size not recorded'}${blocked ? ' · already closed to new bookings' : ''}`
                            }
                            empty={!gone && !!dayInfo && on.length === 0}
                          />
                        );
                      })}
                      <p className={hintClass}>Closing 8:00, 10:30 or 1:00 also closes the all-day charter, which runs through them.</p>
                    </div>
                  )}
                </fieldset>
              )}

              <label className="block">
                <span className={labelClass}>
                  Note <span className="font-normal text-[var(--color-ink-soft)]">(optional, only you see this)</span>
                </span>
                <input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} className={inputClass} placeholder="e.g. Storm coming in" />
              </label>
            </PanelBody>
            <PanelFooter>
              <button
                type="button"
                onClick={() => review()}
                disabled={busy || !dateOk || (farAhead && !farAheadOk)}
                className={clsx(buttonClass('primary'), 'w-full sm:w-auto')}
              >
                {busy ? 'Checking…' : 'Next: review'}
              </button>
            </PanelFooter>
          </>
        )}

        {step.kind === 'review' && (
          <ReviewStep
            preview={step.preview}
            notice={step.notice}
            choice={choice}
            setChoice={(c) => {
              setChoice(c);
              setTyped('');
            }}
            typed={typed}
            setTyped={setTyped}
            previewFor={previewFor}
            setPreviewFor={setPreviewFor}
            busy={busy}
            onBack={() => setStep({ kind: 'form' })}
            onConfirm={() => confirm(step.preview)}
          />
        )}

        {step.kind === 'done' && (
          <>
            <PanelHeader title={step.title ?? (step.pending ? 'Blocked. Sending soon' : 'Done')} />
            <PanelBody>
              <div className="space-y-1 text-sm">
                {step.summary.map((line) => <p key={line}>{line}</p>)}
              </div>
              {step.problems.length > 0 && (
                <div role="alert" className="mt-3 rounded-xl bg-[var(--color-coral)]/10 border border-[var(--color-coral)]/30 p-3 text-sm space-y-1">
                  <p className="font-medium">Still to do:</p>
                  {step.problems.map((line) => <p key={line}>{line}</p>)}
                </div>
              )}
            </PanelBody>
            <PanelFooter>
              <button type="button" onClick={() => setStep({ kind: 'form' })} className={buttonClass('secondary')}>
                Close another day
              </button>
            </PanelFooter>
          </>
        )}
      </section>

      <section className={clsx(panelClass, 'overflow-hidden')}>
        <PanelHeader
          title="Days you’ve closed"
          aside={list !== null && upcoming.length > 0 && <Badge>{upcoming.length} coming up</Badge>}
        />
        {list === null ? (
          <p className="p-5 text-sm text-[var(--color-ink-soft)] animate-pulse">Loading…</p>
        ) : upcoming.length === 0 ? (
          <p className="p-5 text-sm text-[var(--color-ink-soft)]">No upcoming days are closed.</p>
        ) : (
          <ul className="divide-y divide-[var(--color-line)]">
            {upcoming.map((b) => (
              <ClosedDay
                key={b.id}
                b={b}
                waiting={pending.some((p) => p.id === b.id && p.state === 'pending')}
                onReopen={() => reopen(b)}
              />
            ))}
          </ul>
        )}
        {past.length > 0 && showPast && (
          <ul className="divide-y divide-[var(--color-line)] border-t border-[var(--color-line)] opacity-75">
            {past.map((b) => <ClosedDay key={b.id} b={b} />)}
          </ul>
        )}
        <PanelFooter>
          {past.length > 0 && (
            <button
              type="button"
              onClick={() => setShowPast((v) => !v)}
              className="mr-auto text-sm font-semibold text-[var(--color-spring)] underline underline-offset-4 min-h-11"
            >
              {showPast ? 'Hide past closed days' : `Show past closed days (${past.length})`}
            </button>
          )}
          <p className="text-xs text-[var(--color-ink-soft)]">
            Need to cancel one booking instead? Open it from{' '}
            <Link href="/admin/bookings" className="underline underline-offset-4">Bookings</Link>.
          </p>
        </PanelFooter>
      </section>
    </div>
  );
}

/** `window.confirm`, named so it doesn't shadow the confirm step above. */
function confirm_(message: string): boolean {
  return window.confirm(message);
}

/**
 * When settleClosedBookings cancels (and refunds) anyone who hasn't chosen:
 * 6 AM the morning after their last day to choose.
 */
function settles(decideBy: string): string {
  return `${dayShort(addDaysIso(decideBy, 1))} at 6 AM`;
}

/** What closing the day does to one booking, for the review list. */
function outcomeText(o: BookingOutcome, b: ClosurePreview['bookings'][number]): { text: string; warn?: boolean } {
  switch (o.kind) {
    case 'offer':
      return b.owedCents > 0
        ? b.legacy
          ? { text: `Asked to pick a new date, or you refund ${formatPrice(b.owedCents)} yourself (old website). Auto-cancel ${settles(o.decideBy)}`, warn: true }
          : { text: `Asked to pick a new date or take a ${formatPrice(b.owedCents)} refund. Auto-refund ${settles(o.decideBy)}` }
        : { text: `Asked to pick a new date. Nothing paid. Auto-cancel ${settles(o.decideBy)}` };
    case 'cancel':
      if (o.unpaidCheckout) return { text: 'Unfinished checkout: cancelled, nothing was paid' };
      if (o.manualRefundCents > 0) {
        return {
          text: `Cancelled. Refund ${formatPrice(o.manualRefundCents)} yourself: paid on the old website${o.refundCents > 0 ? `, plus ${formatPrice(o.refundCents)} back to their card` : ''}`,
          warn: true,
        };
      }
      return o.refundCents > 0
        ? { text: `Cancelled. ${formatPrice(o.refundCents)} back to their card` }
        : { text: 'Cancelled. Nothing to refund' };
    case 'keep':
      return { text: 'Left booked. You contact them' };
  }
}

function ReviewStep({
  preview,
  notice,
  choice,
  setChoice,
  typed,
  setTyped,
  previewFor,
  setPreviewFor,
  busy,
  onBack,
  onConfirm,
}: {
  preview: ClosurePreview;
  notice?: string;
  choice: ClosureChoice | null;
  setChoice: (c: ClosureChoice) => void;
  typed: string;
  setTyped: (v: string) => void;
  previewFor: string | null;
  setPreviewFor: (id: string) => void;
  busy: boolean;
  onBack: () => void;
  onConfirm: () => void;
}) {
  const bookings = preview.bookings;
  const n = bookings.length;
  const trips = preview.departures.filter((d) => d.bookings > 0);
  const unknownSize = bookings.filter((b) => b.guestCount < 1).length;
  const verb = choice === 'keep' ? 'closing' : 'cancelling';
  const headline =
    n > 0
      ? `You’re ${verb} ${plural(trips.length, 'trip')} on ${dayMedium(preview.date)}: ${plural(preview.guests, 'guest')} in ${plural(n, 'booking')}`
      : `You’re closing ${dayMedium(preview.date)}. Nobody is booked.`;
  const closing = preview.affectedSlots.includes('all')
    ? 'the whole day'
    : joinTimes(preview.departures.map((d) => (d.slot === 'whole-day' ? 'the all-day charter' : d.departs)));
  const emails = choice && choice !== 'keep' ? preview.choices[choice]?.emails ?? [] : [];
  const shown = emails.find((e) => e.bookingId === previewFor) ?? emails[0];
  const typedOk = typed.trim().toLowerCase() === 'cancel';
  const ready = n === 0 || (choice !== null && typedOk);
  const noEmail = bookings.filter((b) => !b.hasEmail);

  return (
    <>
      <div className="px-5 pt-5 pb-4 border-b border-[var(--color-line)] bg-[var(--color-paper)]/70">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-coral-dark)]">Check this carefully</p>
        <h2 className="mt-1 text-display text-[1.5rem] sm:text-[1.75rem] leading-tight">{headline}</h2>
        <p className="mt-2 text-sm text-[var(--color-ink-soft)]">
          No new bookings for {closing}. Reason customers see: {preview.customerReason.toLowerCase()}.
          {unknownSize > 0 && ` Party size isn’t recorded for ${plural(unknownSize, 'booking')}.`}
        </p>
      </div>
      <PanelBody className="space-y-5">
        {notice && (
          <p role="alert" className="rounded-xl bg-[var(--color-buoy)]/12 border border-[var(--color-buoy)]/40 p-3 text-sm font-medium">
            {notice}
          </p>
        )}

        {n > 0 && (
          <fieldset className="grid gap-2">
            <legend className={labelClass}>What should happen to them?</legend>
            <Choice checked={choice === 'offer'} onChange={() => setChoice('offer')} name="choice">
              Email {n === 1 ? 'them' : 'each customer'} to pick a new date, or take a full refund
              <span className="block text-xs text-[var(--color-ink-soft)] mt-1 font-normal">
                They choose on their booking page. Anyone who hasn&rsquo;t by {formatFriendlyDate(preview.decideBy)} is
                cancelled and refunded automatically.
              </span>
            </Choice>
            <Choice checked={choice === 'cancel'} onChange={() => setChoice('cancel')} name="choice">
              Cancel {n === 1 ? 'it' : 'them all'} and email {n === 1 ? 'the customer' : 'each customer'}
              <MoneyNote preview={preview} />
            </Choice>
            <Choice checked={choice === 'keep'} onChange={() => setChoice('keep')} name="choice">
              Leave {n === 1 ? 'it' : 'them'} booked. I’ll contact {n === 1 ? 'them' : 'everyone'} myself
            </Choice>
          </fieldset>
        )}

        {n > 0 && (
          <div>
            <p className={labelClass}>Everyone booked</p>
            <ul className="divide-y divide-[var(--color-line)] border border-[var(--color-line)] rounded-xl">
              {bookings.map((b) => {
                const outcome = choice ? outcomeText(b.outcomes[choice], b) : null;
                return (
                  <li key={b.id} className="px-3 py-3 text-sm flex gap-3">
                    <TimeTile time={b.departs} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-baseline justify-between gap-x-3">
                        <strong className="text-base">{b.customerName || 'No name on file'}</strong>
                        <span className="text-xs text-[var(--color-ink-soft)]">
                          {b.guestCount > 0 ? plural(b.guestCount, 'guest') : 'party size not recorded'}
                        </span>
                      </p>
                      <p className="text-xs text-[var(--color-ink-soft)]">
                        {b.tourName}
                        {b.owedCents > 0 ? ` · paid ${formatPrice(b.owedCents)}` : ' · not paid'}
                        {b.legacy && b.owedCents > 0 && <span className="text-[var(--color-coral-dark)]"> · old website</span>}
                        {b.alreadyOffered && ' · already asked to pick a new date'}
                      </p>
                      {outcome && (
                        <p className={clsx('mt-1 font-medium', outcome.warn && 'text-[var(--color-coral-dark)]')}>{outcome.text}</p>
                      )}
                      {!b.hasEmail && choice !== 'keep' && (
                        <p className="mt-1 font-medium text-[var(--color-coral-dark)]">No email on file: call them.</p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {shown && (
          <div>
            <p className={labelClass}>The email they get</p>
            {emails.length > 1 && (
              <label className="block mb-2">
                <span className="sr-only">Whose email to show</span>
                <select value={shown.bookingId} onChange={(e) => setPreviewFor(e.target.value)} className={inputClass}>
                  {emails.map((e) => {
                    const b = bookings.find((x) => x.id === e.bookingId);
                    return (
                      <option key={e.bookingId} value={e.bookingId}>
                        {b?.customerName ?? e.to} ({b?.departs})
                      </option>
                    );
                  })}
                </select>
              </label>
            )}
            <div className="rounded-xl border border-[var(--color-line)] overflow-hidden">
              <p className="px-3 py-2 text-xs bg-[var(--color-paper)] border-b border-[var(--color-line)] break-words">
                <span className="text-[var(--color-ink-soft)]">To:</span> {shown.to}
                <br />
                <span className="text-[var(--color-ink-soft)]">Subject:</span> <strong>{shown.subject}</strong>
              </p>
              <iframe
                title={`Email to ${shown.to}`}
                srcDoc={shown.html}
                sandbox=""
                className="block w-full h-[28rem] bg-white"
              />
            </div>
            {noEmail.length > 0 && (
              <p className={hintClass}>
                {plural(noEmail.length, 'customer has', 'customers have')} no email on file and won’t get one.
              </p>
            )}
          </div>
        )}

        {n > 0 && (
          <div className="rounded-xl border-2 border-[var(--color-coral)]/40 bg-[var(--color-coral)]/5 p-3.5">
            <p className="text-sm">
              {preview.undoMinutes > 0
                ? `The trips are blocked as soon as you confirm. Nothing is sent, cancelled or refunded for ${plural(preview.undoMinutes, 'minute')}, so you can still undo it.`
                : 'This goes out as soon as you confirm. There’s no undo: the undo time in Settings is 0.'}
            </p>
            <label className="block mt-3">
              <span className={labelClass}>Type CANCEL to confirm</span>
              <input
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                disabled={!choice}
                autoCapitalize="characters"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                placeholder={choice ? 'CANCEL' : 'Choose what happens to them first'}
                className={inputClass}
              />
            </label>
          </div>
        )}
      </PanelBody>

      <PanelFooter>
        <button
          type="button"
          onClick={onBack}
          disabled={busy}
          className={clsx(buttonClass('secondary'), 'w-full sm:w-auto')}
        >
          Go back
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy || !ready}
          // On a phone the two stack full width, this one on top.
          className={clsx(buttonClass('destructive'), 'w-full sm:w-auto order-first sm:order-none min-h-12')}
        >
          {busy
            ? 'Closing…'
            : n > 0 && choice === 'cancel'
              ? `Close it and cancel ${plural(n, 'booking')}`
              : n > 0 && choice === 'offer'
                ? `Close it and email ${n === 1 ? 'the customer' : `${n} customers`}`
                : 'Close it'}
        </button>
      </PanelFooter>
    </>
  );
}

function MoneyNote({ preview }: { preview: ClosurePreview }) {
  let auto = 0;
  const manual: string[] = [];
  for (const b of preview.bookings) {
    const o = b.outcomes.cancel;
    if (o.kind !== 'cancel') continue;
    auto += o.refundCents;
    if (o.manualRefundCents > 0) manual.push(`${b.customerName} ${formatPrice(o.manualRefundCents)}`);
  }
  return (
    <span className="block text-xs text-[var(--color-ink-soft)] mt-1 font-normal">
      {auto > 0 && <>{formatPrice(auto)} goes back to their cards automatically. </>}
      {manual.length > 0 && (
        <span className="text-[var(--color-coral-dark)]">
          {manual.join(', ')} paid on the old website: you’ll refund {manual.length === 1 ? 'that' : 'those'} yourself.
        </span>
      )}
    </span>
  );
}

function ClosedDay({ b, onReopen, waiting = false }: { b: BlackoutDoc; onReopen?: () => void; waiting?: boolean }) {
  const what = b.affectedSlots.includes('all')
    ? 'Whole day'
    : b.affectedSlots.map((s) => DEPARTURES.find((d) => d.slot === s)?.label ?? s).join(', ');
  const why = REASON_OPTIONS.find((o) => o.value === b.reason)?.label;
  return (
    <li className="px-5 py-3.5 flex items-center gap-4">
      <DateTile iso={b.date} />
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-semibold">
          {formatFriendlyDate(b.date)} {waiting && <Badge tone="buoy">Sending soon</Badge>}
        </p>
        <p className="text-[var(--color-ink-soft)]">
          {what}
          {why && ` · ${why}`}
          {b.notes && ` · ${b.notes}`}
        </p>
      </div>
      {onReopen && (
        <button type="button" onClick={onReopen} className={clsx(buttonClass('secondary', 'sm'), 'shrink-0')}>
          {waiting ? 'Undo' : 'Reopen'}
        </button>
      )}
    </li>
  );
}

/** One row in the trip picker: a radio for the whole day, a checkbox per departure. */
function TripRow({
  type,
  checked,
  disabled = false,
  onChange,
  title,
  detail,
  time,
  muted = false,
  empty = false,
}: {
  type: 'radio' | 'checkbox';
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
  title: string;
  detail?: string;
  time?: string;
  muted?: boolean;
  empty?: boolean;
}) {
  return (
    <label
      className={clsx(
        'mt-2 flex items-center gap-3 rounded-xl border px-3.5 py-3 text-sm transition-colors',
        disabled
          ? 'cursor-not-allowed border-[var(--color-line)] bg-[var(--color-paper)] text-[var(--color-ink-soft)]'
          : checked
            ? 'cursor-pointer border-[var(--color-coral)] bg-[var(--color-coral)]/5 ring-1 ring-[var(--color-coral)]'
            : clsx('cursor-pointer bg-white hover:border-[var(--color-ink-soft)]', empty ? 'border-dashed border-[var(--color-line-strong)]' : 'border-[var(--color-line-strong)]'),
      )}
    >
      <input
        type={type}
        name={type === 'radio' ? 'what' : undefined}
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        className="w-5 h-5 shrink-0"
      />
      {time && <TimeTile time={time} size="sm" muted={muted} />}
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{title}</span>
        {detail && <span className="block text-xs text-[var(--color-ink-soft)] mt-0.5">{detail}</span>}
      </span>
    </label>
  );
}

function Choice({
  checked,
  onChange,
  name,
  children,
}: {
  checked: boolean;
  onChange: () => void;
  name: string;
  children: React.ReactNode;
}) {
  return (
    <label
      className={clsx(
        'flex items-start gap-3 rounded-xl border px-3.5 py-3 text-sm cursor-pointer transition-colors',
        checked
          ? 'border-[var(--color-spring)] bg-[var(--color-mist)] ring-1 ring-[var(--color-spring)]'
          : 'border-[var(--color-line-strong)] bg-white hover:border-[var(--color-ink-soft)]',
      )}
    >
      <input type="radio" name={name} checked={checked} onChange={onChange} className="w-5 h-5 mt-0.5 shrink-0" />
      <span className="font-medium">{children}</span>
    </label>
  );
}

/** The reasons Close a day accepts, e.g. from `?reason=` in a link. */
export const CLOSE_DAY_REASONS: readonly string[] = REASON_OPTIONS.map((o) => o.value);

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { admin } from '@/lib/admin-client';
import { FunctionError } from '@/lib/functions-client';
import {
  listAllBlackouts,
  listBookingsBetween,
  type BlackoutDoc,
  type BookingDoc,
} from '@/lib/admin-firestore';
import { WHOLE_DAY_OVERLAPS, marinaNow } from '@/lib/availability';
import { formatPrice, slotLabels, slotOrder, tours, type TourTimeSlot } from '@/lib/tours';
import { formatFriendlyDate } from '@/lib/date';
import { clsx } from '@/lib/clsx';
import { canRefundHere, departureMinutes, departureTime, partySize } from './booking-labels';
import {
  Badge,
  PanelBody,
  PanelFooter,
  PanelHeader,
  buttonClass,
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
type Reason = (typeof REASON_OPTIONS)[number]['value'];

/** Every departure Travis can close, in time order, with its start time. */
const DEPARTURES: Array<{ slot: TourTimeSlot; label: string }> = [...slotOrder, 'whole-day' as const].map((slot) => {
  const tour = tours.find((t) => t.timeSlot === slot);
  return {
    slot,
    label: slot === 'whole-day'
      ? 'All-day private charter'
      : `${slotLabels[slot]}${tour ? ` (${tour.startTimeDisplay})` : ''}`,
  };
});

/** Same rule as the server: closing a slot the charter runs through also closes the charter. */
function affects(slot: string, closed: string[]): boolean {
  if (closed.includes('all') || closed.includes(slot)) return true;
  return slot === 'whole-day' && closed.some((s) => (WHOLE_DAY_OVERLAPS as string[]).includes(s));
}

function owedCents(b: BookingDoc): number {
  return Math.max(0, b.amountPaidCents - b.amountRefundedCents);
}

type Step =
  | { kind: 'form' }
  | { kind: 'review'; bookings: BookingDoc[] }
  | { kind: 'done'; summary: string[]; problems: string[] };

export function BlackoutsAdmin() {
  const [list, setList] = useState<BlackoutDoc[] | null>(null);
  const [showPast, setShowPast] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Marina date: the server renders this in UTC, the browser wherever it is.
  const today = marinaNow().date;

  const [date, setDate] = useState(today);
  const [wholeDay, setWholeDay] = useState(true);
  const [slots, setSlots] = useState<Set<string>>(new Set());
  const [reason, setReason] = useState<Reason>('weather');
  const [notes, setNotes] = useState('');
  // No default: Travis has to say what happens to people already booked.
  const [cancelChoice, setCancelChoice] = useState<'cancel' | 'keep' | null>(null);
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
  }, []);

  const closed = wholeDay ? ['all'] : [...slots];
  const whatText = wholeDay
    ? 'the whole day'
    : DEPARTURES.filter((d) => slots.has(d.slot)).map((d) => d.label).join(', ');

  function toggleSlot(s: string) {
    setSlots((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  }

  async function review() {
    setError(null);
    if (closed.length === 0) {
      setError('Pick at least one departure to close, or choose “The whole day”.');
      return;
    }
    setBusy(true);
    try {
      const onDay = await listBookingsBetween(date, date);
      const affected = onDay
        .filter((b) => (b.status === 'confirmed' || b.status === 'pending-payment') && affects(b.timeSlot, closed))
        .sort((a, b) => departureMinutes(a) - departureMinutes(b));
      setCancelChoice(null);
      setStep({ kind: 'review', bookings: affected });
    } catch {
      setError('Couldn’t check who’s booked that day. Check your signal and try again.');
    } finally {
      setBusy(false);
    }
  }

  async function closeDay(bookings: BookingDoc[]) {
    setError(null);
    setBusy(true);
    const cancel = bookings.length > 0 && cancelChoice === 'cancel';
    try {
      const r = await admin.createBlackout({
        date,
        affectedSlots: closed as never,
        reason,
        notes: notes.trim() || undefined,
        cancelAffected: cancel,
      });
      const summary = [`${formatFriendlyDate(date)} is closed (${whatText}). Nobody can book it online now.`];
      const problems: string[] = [];
      if (cancel) {
        const done = r.cancelled ?? [];
        const auto = done.reduce((s, c) => s + c.refundCents, 0);
        const manual = done.filter((c) => c.manualRefundCents > 0);
        // No email on file (old-site bookings) or the send failed: Travis
        // has to tell these people himself.
        const notEmailed = done.filter((c) => !c.emailed);
        const emailed = done.length - notEmailed.length;
        if (done.length) {
          summary.push(
            emailed === done.length
              ? `Cancelled ${done.length} booking${done.length === 1 ? '' : 's'} and emailed ${done.length === 1 ? 'the customer' : 'each customer'}.`
              : `Cancelled ${done.length} booking${done.length === 1 ? '' : 's'}. Emailed ${emailed} of them.`,
          );
        }
        if (auto > 0) summary.push(`${formatPrice(auto)} is going back to their cards.`);
        for (const n of notEmailed) problems.push(`Call or text ${n.customerName}: they weren’t emailed that their tour is off.`);
        for (const m of manual) problems.push(`Refund ${formatPrice(m.manualRefundCents)} to ${m.customerName} yourself (paid on the old website).`);
        for (const f of r.failed ?? []) problems.push(`${f.customerName}’s booking was NOT cancelled. Open it and cancel it there.`);
      } else if (bookings.length > 0) {
        problems.push(`${bookings.length} booking${bookings.length === 1 ? ' is' : 's are'} still on for that day. Contact ${bookings.length === 1 ? 'that customer' : 'those customers'} yourself.`);
      }
      setStep({ kind: 'done', summary, problems });
      setNotes('');
      await refresh();
    } catch (err) {
      setError(
        err instanceof FunctionError
          ? err.message
          : 'We lost the connection. Check the list of closed days below before trying again: it may have gone through.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function reopen(b: BlackoutDoc) {
    if (!confirm(`Reopen ${formatFriendlyDate(b.date)} for booking?\n\nBookings that were cancelled stay cancelled.`)) return;
    try {
      await admin.deleteBlackout(b.id);
      await refresh();
    } catch (err) {
      setError(err instanceof FunctionError ? err.message : 'That didn’t go through. Try again in a minute.');
    }
  }

  const upcoming = (list ?? []).filter((b) => b.date >= today);
  const past = (list ?? []).filter((b) => b.date < today).reverse();

  return (
    <div className="space-y-6">
      {error && (
        <div role="alert" className="rounded-2xl bg-[var(--color-coral)]/10 border border-[var(--color-coral)]/30 p-3 text-sm">
          {error}
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
                  <input type="date" value={date} min={today} onChange={(e) => setDate(e.target.value)} className={inputClass} />
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

              <fieldset>
                <legend className={labelClass}>What to close</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Choice checked={wholeDay} onChange={() => setWholeDay(true)} name="what">The whole day</Choice>
                  <Choice checked={!wholeDay} onChange={() => setWholeDay(false)} name="what">Only some departures</Choice>
                </div>
                {!wholeDay && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {DEPARTURES.map((d) => (
                      <label
                        key={d.slot}
                        className={clsx(
                          // The checkbox inside is visually hidden; show its keyboard focus on the chip.
                          'inline-flex min-h-11 items-center px-4 rounded-full text-sm font-medium cursor-pointer border transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--color-spring)]',
                          slots.has(d.slot)
                            ? 'bg-[var(--color-spring)] text-white border-[var(--color-spring)]'
                            : 'bg-white border-[var(--color-line-strong)] hover:border-[var(--color-ink-soft)]',
                        )}
                      >
                        <input type="checkbox" checked={slots.has(d.slot)} onChange={() => toggleSlot(d.slot)} className="sr-only" />
                        {d.label}
                      </label>
                    ))}
                  </div>
                )}
              </fieldset>

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
                onClick={review}
                disabled={busy}
                className={clsx(buttonClass('primary'), 'w-full sm:w-auto')}
              >
                {busy ? 'Checking…' : 'Next: see who’s booked'}
              </button>
            </PanelFooter>
          </>
        )}

        {step.kind === 'review' && (
          <>
            <PanelHeader title={`Close ${formatFriendlyDate(date)}?`} description={`Closing ${whatText}.`} />
            <PanelBody>
              {step.bookings.length === 0 ? (
                <p className="text-sm">Nobody is booked then. Closing it just stops new bookings.</p>
              ) : (
                <>
                  <p className="text-sm font-semibold">
                    {step.bookings.length} booking{step.bookings.length === 1 ? ' is' : 's are'} on then:
                  </p>
                  <ul className="mt-2 divide-y divide-[var(--color-line)] border border-[var(--color-line)] rounded-xl">
                    {step.bookings.map((b) => (
                      <li key={b.id} className="px-3 py-2.5 text-sm flex justify-between gap-3">
                        <span>
                          <strong>{b.customerName}</strong>
                          <span className="block text-xs text-[var(--color-ink-soft)]">
                            {departureTime(b)} · {partySize(b)}
                          </span>
                        </span>
                        <span className="text-right text-xs">
                          {owedCents(b) > 0 ? `paid ${formatPrice(owedCents(b))}` : 'not paid'}
                          {owedCents(b) > 0 && !canRefundHere(b) && (
                            <span className="block text-[var(--color-coral-dark)]">old website</span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>

                  <fieldset className="mt-5 grid gap-2">
                    <legend className={labelClass}>What should happen to them?</legend>
                    <Choice checked={cancelChoice === 'cancel'} onChange={() => setCancelChoice('cancel')} name="cancel">
                      Cancel {step.bookings.length === 1 ? 'it' : 'them all'} and email {step.bookings.length === 1 ? 'the customer' : 'each customer'}
                      <MoneyNote bookings={step.bookings} />
                    </Choice>
                    <Choice checked={cancelChoice === 'keep'} onChange={() => setCancelChoice('keep')} name="cancel">
                      Leave {step.bookings.length === 1 ? 'it' : 'them'} booked. I’ll contact {step.bookings.length === 1 ? 'them' : 'everyone'} myself
                    </Choice>
                  </fieldset>
                </>
              )}
            </PanelBody>

            <PanelFooter>
              <button
                type="button"
                onClick={() => setStep({ kind: 'form' })}
                disabled={busy}
                className={clsx(buttonClass('secondary'), 'w-full sm:w-auto')}
              >
                Go back
              </button>
              <button
                type="button"
                onClick={() => closeDay(step.bookings)}
                disabled={busy || (step.bookings.length > 0 && cancelChoice === null)}
                // On a phone the two stack full width, this one on top.
                className={clsx(buttonClass('destructive'), 'w-full sm:w-auto order-first sm:order-none')}
              >
                {busy
                  ? 'Closing…'
                  : step.bookings.length > 0 && cancelChoice === 'cancel'
                    ? `Close it and cancel ${step.bookings.length} booking${step.bookings.length === 1 ? '' : 's'}`
                    : 'Close it'}
              </button>
            </PanelFooter>
          </>
        )}

        {step.kind === 'done' && (
          <>
            <PanelHeader title="Done" />
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
            {upcoming.map((b) => <ClosedDay key={b.id} b={b} onReopen={() => reopen(b)} />)}
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

function MoneyNote({ bookings }: { bookings: BookingDoc[] }) {
  const auto = bookings.filter(canRefundHere).reduce((s, b) => s + owedCents(b), 0);
  const manual = bookings.filter((b) => !canRefundHere(b) && owedCents(b) > 0);
  return (
    <span className="block text-xs text-[var(--color-ink-soft)] mt-1 font-normal">
      {auto > 0 && <>{formatPrice(auto)} goes back to their cards automatically. </>}
      {manual.length > 0 && (
        <span className="text-[var(--color-coral-dark)]">
          {manual.map((b) => `${b.customerName} ${formatPrice(owedCents(b))}`).join(', ')} paid on the old
          website: you’ll refund {manual.length === 1 ? 'that' : 'those'} yourself.
        </span>
      )}
    </span>
  );
}

function ClosedDay({ b, onReopen }: { b: BlackoutDoc; onReopen?: () => void }) {
  const what = b.affectedSlots.includes('all')
    ? 'Whole day'
    : b.affectedSlots.map((s) => DEPARTURES.find((d) => d.slot === s)?.label ?? s).join(', ');
  const why = REASON_OPTIONS.find((o) => o.value === b.reason)?.label;
  const [y, m, d] = b.date.split('-').map(Number);
  const month = new Date(y!, m! - 1, d!).toLocaleDateString('en-US', { month: 'short' });
  return (
    <li className="px-5 py-3.5 flex items-center gap-4">
      <div
        aria-hidden
        className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)]"
      >
        <span className="text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-[var(--color-coral-dark)]">{month}</span>
        <span className="font-display text-lg font-bold leading-none tabular-nums">{d}</span>
      </div>
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-semibold">{formatFriendlyDate(b.date)}</p>
        <p className="text-[var(--color-ink-soft)]">
          {what}
          {why && ` · ${why}`}
          {b.notes && ` · ${b.notes}`}
        </p>
      </div>
      {onReopen && (
        <button type="button" onClick={onReopen} className={clsx(buttonClass('secondary', 'sm'), 'shrink-0')}>
          Reopen
        </button>
      )}
    </li>
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

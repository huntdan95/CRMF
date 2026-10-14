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

  const inputClass =
    'w-full rounded-xl border border-[var(--color-ink)]/15 bg-white px-3 py-2.5 text-base focus:border-[var(--color-brand-blue)] focus:outline-2 focus:outline-[var(--color-brand-blue)]/20';
  const upcoming = (list ?? []).filter((b) => b.date >= today);
  const past = (list ?? []).filter((b) => b.date < today).reverse();

  return (
    <div className="space-y-6">
      {error && (
        <div role="alert" className="rounded-2xl bg-[var(--color-coral)]/10 border border-[var(--color-coral)]/30 p-3 text-sm">
          {error}
        </div>
      )}

      <section className="bg-white rounded-2xl border border-[var(--color-ink)]/8 shadow-[var(--shadow-card)] p-5">
        {step.kind === 'form' && (
          <>
            <h2 className="font-display text-xl mb-4">Close a day</h2>
            <div className="grid sm:grid-cols-2 gap-4">
              <label className="block">
                <span className="block text-sm font-medium mb-1">Date</span>
                <input type="date" value={date} min={today} onChange={(e) => setDate(e.target.value)} className={inputClass} />
              </label>
              <label className="block">
                <span className="block text-sm font-medium mb-1">Why</span>
                <select value={reason} onChange={(e) => setReason(e.target.value as Reason)} className={inputClass}>
                  {REASON_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </label>
            </div>

            <fieldset className="mt-4">
              <legend className="text-sm font-medium mb-2">What to close</legend>
              <div className="grid gap-2">
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
                        'px-4 py-2.5 rounded-full text-sm cursor-pointer border has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--color-brand-blue)]',
                        slots.has(d.slot)
                          ? 'bg-[var(--color-brand-blue)] text-white border-[var(--color-brand-blue)]'
                          : 'bg-white border-[var(--color-ink)]/15 hover:bg-[var(--color-ink)]/5',
                      )}
                    >
                      <input type="checkbox" checked={slots.has(d.slot)} onChange={() => toggleSlot(d.slot)} className="sr-only" />
                      {d.label}
                    </label>
                  ))}
                </div>
              )}
            </fieldset>

            <label className="block mt-4">
              <span className="block text-sm font-medium mb-1">
                Note <span className="font-normal text-[var(--color-ink-soft)]">(optional, only you see this)</span>
              </span>
              <input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} className={inputClass} placeholder="e.g. Storm coming in" />
            </label>

            <button
              type="button"
              onClick={review}
              disabled={busy}
              className="mt-5 w-full sm:w-auto inline-flex items-center justify-center px-5 py-3 rounded-[10px] bg-[var(--color-brand-blue)] hover:bg-[var(--color-brand-blue-dark)] text-white font-medium disabled:opacity-60"
            >
              {busy ? 'Checking…' : 'Next: see who’s booked'}
            </button>
          </>
        )}

        {step.kind === 'review' && (
          <>
            <h2 className="font-display text-xl">Close {formatFriendlyDate(date)}?</h2>
            <p className="text-sm text-[var(--color-ink-soft)] mt-1">Closing {whatText}.</p>

            {step.bookings.length === 0 ? (
              <p className="mt-4 text-sm">Nobody is booked then. Closing it just stops new bookings.</p>
            ) : (
              <>
                <p className="mt-4 text-sm font-medium">
                  {step.bookings.length} booking{step.bookings.length === 1 ? ' is' : 's are'} on then:
                </p>
                <ul className="mt-2 divide-y divide-[var(--color-ink)]/8 border border-[var(--color-ink)]/8 rounded-xl">
                  {step.bookings.map((b) => (
                    <li key={b.id} className="px-3 py-2 text-sm flex justify-between gap-3">
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

                <fieldset className="mt-4 grid gap-2">
                  <legend className="text-sm font-medium mb-2">What should happen to them?</legend>
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

            <div className="mt-5 flex flex-col-reverse sm:flex-row gap-2">
              <button
                type="button"
                onClick={() => setStep({ kind: 'form' })}
                disabled={busy}
                className="px-4 py-3 rounded-[10px] border border-[var(--color-ink)]/15 hover:bg-[var(--color-ink)]/5"
              >
                Go back
              </button>
              <button
                type="button"
                onClick={() => closeDay(step.bookings)}
                disabled={busy || (step.bookings.length > 0 && cancelChoice === null)}
                className="px-5 py-3 rounded-[10px] bg-[var(--color-coral)] hover:bg-[var(--color-coral-dark)] text-white font-medium disabled:opacity-50"
              >
                {busy
                  ? 'Closing…'
                  : step.bookings.length > 0 && cancelChoice === 'cancel'
                    ? `Close it and cancel ${step.bookings.length} booking${step.bookings.length === 1 ? '' : 's'}`
                    : 'Close it'}
              </button>
            </div>
          </>
        )}

        {step.kind === 'done' && (
          <>
            <h2 className="font-display text-xl">Done</h2>
            <div className="mt-2 space-y-1 text-sm">
              {step.summary.map((line) => <p key={line}>{line}</p>)}
            </div>
            {step.problems.length > 0 && (
              <div role="alert" className="mt-3 rounded-xl bg-[var(--color-coral)]/10 border border-[var(--color-coral)]/30 p-3 text-sm space-y-1">
                <p className="font-medium">Still to do:</p>
                {step.problems.map((line) => <p key={line}>{line}</p>)}
              </div>
            )}
            <button
              type="button"
              onClick={() => setStep({ kind: 'form' })}
              className="mt-4 px-4 py-3 rounded-[10px] border border-[var(--color-ink)]/15 hover:bg-[var(--color-ink)]/5"
            >
              Close another day
            </button>
          </>
        )}
      </section>

      <section className="bg-white rounded-2xl border border-[var(--color-ink)]/8 shadow-[var(--shadow-card)] p-5">
        <h2 className="font-display text-xl mb-3">Days you’ve closed</h2>
        {list === null ? (
          <p className="text-sm text-[var(--color-ink-soft)] animate-pulse">Loading…</p>
        ) : upcoming.length === 0 ? (
          <p className="text-sm text-[var(--color-ink-soft)]">No upcoming days are closed.</p>
        ) : (
          <ul className="divide-y divide-[var(--color-ink)]/8">
            {upcoming.map((b) => <ClosedDay key={b.id} b={b} onReopen={() => reopen(b)} />)}
          </ul>
        )}
        {past.length > 0 && (
          <>
            <button
              type="button"
              onClick={() => setShowPast((v) => !v)}
              className="mt-3 text-sm text-[var(--color-brand-blue)] underline underline-offset-4 min-h-11"
            >
              {showPast ? 'Hide past closed days' : `Show past closed days (${past.length})`}
            </button>
            {showPast && (
              <ul className="divide-y divide-[var(--color-ink)]/8 opacity-75">
                {past.map((b) => <ClosedDay key={b.id} b={b} />)}
              </ul>
            )}
          </>
        )}
        <p className="mt-4 text-xs text-[var(--color-ink-soft)]">
          Need to cancel one booking instead? Open it from{' '}
          <Link href="/admin/bookings" className="underline underline-offset-4">Bookings</Link>.
        </p>
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
  return (
    <li className="py-3 flex items-start justify-between gap-3">
      <div className="text-sm">
        <p className="font-medium">{formatFriendlyDate(b.date)}</p>
        <p className="text-[var(--color-ink-soft)]">
          {what}
          {why && ` · ${why}`}
          {b.notes && ` · ${b.notes}`}
        </p>
      </div>
      {onReopen && (
        <button
          type="button"
          onClick={onReopen}
          className="shrink-0 px-4 py-2.5 rounded-[10px] text-sm font-medium border border-[var(--color-ink)]/15 hover:bg-[var(--color-ink)]/5"
        >
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
        'flex items-start gap-3 rounded-xl border px-3 py-3 text-sm cursor-pointer',
        checked ? 'border-[var(--color-brand-blue)] bg-[var(--color-brand-blue)]/5' : 'border-[var(--color-ink)]/15',
      )}
    >
      <input type="radio" name={name} checked={checked} onChange={onChange} className="w-5 h-5 mt-0.5 shrink-0" />
      <span className="font-medium">{children}</span>
    </label>
  );
}

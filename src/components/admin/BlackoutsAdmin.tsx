'use client';

import { useEffect, useState } from 'react';
import { admin } from '@/lib/admin-client';
import { FunctionError } from '@/lib/functions-client';
import {
  listAllBlackouts,
  type BlackoutDoc,
} from '@/lib/admin-firestore';
import { slotLabels, slotOrder } from '@/lib/tours';
import { formatFriendlyDate, isoDate, startOfDay } from '@/lib/date';
import { clsx } from '@/lib/clsx';

const REASON_OPTIONS = [
  { value: 'weather', label: 'Weather' },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'personal', label: 'Personal' },
  { value: 'other', label: 'Other' },
] as const;

export function BlackoutsAdmin() {
  const [list, setList] = useState<BlackoutDoc[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const today = isoDate(startOfDay(new Date()));

  // Add-form state
  const [date, setDate] = useState(today);
  const [allSlots, setAllSlots] = useState(true);
  const [slots, setSlots] = useState<Set<string>>(new Set());
  const [reason, setReason] = useState<typeof REASON_OPTIONS[number]['value']>('weather');
  const [notes, setNotes] = useState('');
  const [cancelAffected, setCancelAffected] = useState(true);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setError(null);
    try {
      const all = await listAllBlackouts();
      setList(all);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load.');
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  function toggleSlot(s: string) {
    setSlots((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  }

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      const affected = allSlots
        ? (['all'] as ('all' | typeof slotOrder[number] | 'whole-day')[])
        : ([...slots] as ('all' | typeof slotOrder[number] | 'whole-day')[]);
      if (affected.length === 0) {
        setError('Pick at least one slot, or check "Whole day".');
        setBusy(false);
        return;
      }
      const result = await admin.createBlackout({
        date,
        affectedSlots: affected as never,
        reason,
        notes: notes.trim() || undefined,
        cancelAffected,
      });
      setFlash(
        result.cancelledBookingIds.length > 0
          ? `Blackout created. Cancelled ${result.cancelledBookingIds.length} affected booking${result.cancelledBookingIds.length === 1 ? '' : 's'} with full refund.`
          : 'Blackout created.',
      );
      setNotes('');
      setAllSlots(true);
      setSlots(new Set());
      await refresh();
    } catch (err) {
      setError(err instanceof FunctionError ? err.message : 'Failed.');
    } finally {
      setBusy(false);
    }
  }

  async function deleteBlackout(id: string) {
    if (!confirm('Delete this blackout? Bookings on that day are NOT restored.')) return;
    try {
      await admin.deleteBlackout(id);
      setFlash('Blackout deleted.');
      await refresh();
    } catch (err) {
      setError(err instanceof FunctionError ? err.message : 'Failed.');
    }
  }

  const inputClass =
    'w-full rounded-xl border border-[var(--color-ink)]/15 bg-white px-3 py-2 text-base focus:border-[var(--color-brand-blue)] focus:outline-2 focus:outline-[var(--color-brand-blue)]/20';

  return (
    <div className="space-y-6">
      {flash && (
        <div className="rounded-2xl bg-[var(--color-brand-blue)]/10 border border-[var(--color-brand-blue)]/20 p-3 text-sm">
          {flash}
        </div>
      )}
      {error && (
        <div className="rounded-2xl bg-[var(--color-coral)]/10 border border-[var(--color-coral)]/30 p-3 text-sm">
          {error}
        </div>
      )}

      <section className="bg-white rounded-2xl border border-[var(--color-ink)]/8 shadow-[var(--shadow-card)] p-5">
        <h2 className="font-display text-xl mb-4">Add a blackout</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          <label className="block">
            <span className="block text-sm font-medium mb-1">Date</span>
            <input
              type="date"
              value={date}
              min={today}
              onChange={(e) => setDate(e.target.value)}
              className={inputClass}
            />
          </label>
          <label className="block">
            <span className="block text-sm font-medium mb-1">Reason</span>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value as typeof reason)}
              className={inputClass}
            >
              {REASON_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <fieldset className="mt-4">
          <legend className="text-sm font-medium mb-2">Affected slots</legend>
          <label className="flex items-center gap-2 text-sm mb-2">
            <input
              type="checkbox"
              checked={allSlots}
              onChange={(e) => setAllSlots(e.target.checked)}
              className="w-4 h-4"
            />
            Whole day (closes every slot)
          </label>
          {!allSlots && (
            <div className="flex flex-wrap gap-2">
              {[...slotOrder, 'whole-day' as const].map((s) => (
                <label
                  key={s}
                  className={clsx(
                    'px-3 py-1.5 rounded-full text-xs cursor-pointer border',
                    slots.has(s)
                      ? 'bg-[var(--color-brand-blue)] text-white border-[var(--color-brand-blue)]'
                      : 'bg-white border-[var(--color-ink)]/15 hover:bg-[var(--color-ink)]/5',
                  )}
                >
                  <input
                    type="checkbox"
                    checked={slots.has(s)}
                    onChange={() => toggleSlot(s)}
                    className="sr-only"
                  />
                  {slotLabels[s as keyof typeof slotLabels] ?? s}
                </label>
              ))}
            </div>
          )}
        </fieldset>

        <label className="block mt-4">
          <span className="block text-sm font-medium mb-1">Notes (internal)</span>
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={500}
            className={inputClass}
            placeholder="e.g., Tropical storm Hugo expected"
          />
        </label>

        <label className="flex items-start gap-2 mt-4 text-sm">
          <input
            type="checkbox"
            checked={cancelAffected}
            onChange={(e) => setCancelAffected(e.target.checked)}
            className="w-4 h-4 mt-0.5"
          />
          <span>
            Cancel all affected bookings and full-refund them. Customers will
            be emailed automatically.
          </span>
        </label>

        <button
          type="button"
          onClick={submit}
          disabled={busy}
          className="mt-5 inline-flex items-center px-5 py-2.5 rounded-full bg-[var(--color-brand-blue)] hover:bg-[var(--color-brand-blue-dark)] text-white font-medium disabled:opacity-60"
        >
          {busy ? 'Saving…' : 'Add blackout'}
        </button>
      </section>

      <section className="bg-white rounded-2xl border border-[var(--color-ink)]/8 shadow-[var(--shadow-card)] overflow-hidden">
        <h2 className="font-display text-xl px-5 py-4 border-b border-[var(--color-ink)]/8">
          Existing blackouts
        </h2>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-[var(--color-cream)] text-[var(--color-ink-soft)]">
              <tr>
                <th className="text-left px-4 py-2 font-medium uppercase text-xs tracking-widest">Date</th>
                <th className="text-left px-4 py-2 font-medium uppercase text-xs tracking-widest">Slots</th>
                <th className="text-left px-4 py-2 font-medium uppercase text-xs tracking-widest">Reason</th>
                <th className="text-left px-4 py-2 font-medium uppercase text-xs tracking-widest">Notes</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {list === null ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-[var(--color-ink-soft)] animate-pulse">
                    Loading…
                  </td>
                </tr>
              ) : list.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-[var(--color-ink-soft)]">
                    No blackouts.
                  </td>
                </tr>
              ) : (
                list.map((b) => (
                  <tr key={b.id} className="border-t border-[var(--color-ink)]/8">
                    <td className="px-4 py-2">
                      <div className="font-mono text-xs">{b.date}</div>
                      <div className="text-xs text-[var(--color-ink-soft)]">
                        {formatFriendlyDate(b.date)}
                      </div>
                    </td>
                    <td className="px-4 py-2 text-xs">
                      {b.affectedSlots.includes('all')
                        ? 'Whole day'
                        : b.affectedSlots
                            .map((s) => slotLabels[s as keyof typeof slotLabels] ?? s)
                            .join(', ')}
                    </td>
                    <td className="px-4 py-2 text-xs capitalize">{b.reason ?? '—'}</td>
                    <td className="px-4 py-2 text-xs">{b.notes ?? '—'}</td>
                    <td className="px-4 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => deleteBlackout(b.id)}
                        className="text-xs text-[var(--color-coral-dark)] hover:underline"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

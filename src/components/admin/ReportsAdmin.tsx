'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  listBookingsBetween,
  type BookingDoc,
} from '@/lib/admin-firestore';
import { slotLabels } from '@/lib/tours';
import { marinaNow } from '@/lib/availability';
import { isLegacy, paymentLabel, statusLabel, typeLabel } from './booking-labels';

/** "$48,250" — totals here get big enough to need the comma. */
function money(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US', {
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Rows that would count the same money twice or never had any: an abandoned
 * checkout, or an old-site booking that was rescheduled (its payment moved
 * with it to the booking it became).
 */
function countsTowardMoney(b: BookingDoc): boolean {
  if (b.paymentStatus === 'failed') return false;
  if (isLegacy(b) && b.status === 'cancelled' && b.cancellationReason?.startsWith('Rescheduled on the old site')) return false;
  return true;
}

const inputClass =
  'rounded-xl border border-[var(--color-ink)]/15 bg-white px-3 py-2 text-base focus:border-[var(--color-brand-blue)] focus:outline-2 focus:outline-[var(--color-brand-blue)]/20';

/** This month at the marina (not the server's UTC month, or the browser's). */
function monthRange() {
  const month = marinaNow().date.slice(0, 7);
  const [y, m] = month.split('-').map(Number) as [number, number];
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start: `${month}-01`, end: `${month}-${String(lastDay).padStart(2, '0')}` };
}

export function ReportsAdmin() {
  const initial = monthRange();
  const [from, setFrom] = useState(initial.start);
  const [to, setTo] = useState(initial.end);
  const [rows, setRows] = useState<BookingDoc[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(start = from, end = to) {
    setLoading(true);
    setError(null);
    try {
      const all = await listBookingsBetween(start, end);
      setRows(all);
    } catch {
      setError('Couldn’t load the report. Check your signal and try again.');
    } finally {
      setLoading(false);
    }
  }

  // Show this month straight away instead of an empty page.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loading on mount
    void run(initial.start, initial.end);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stats = useMemo(() => {
    if (!rows) return null;
    const counted = rows.filter(countsTowardMoney);
    const confirmed = counted.filter((b) => b.status === 'confirmed' || b.status === 'completed');
    const cancelled = counted.filter((b) => b.status === 'cancelled');
    const noShow = counted.filter((b) => b.status === 'no-show');
    // Money is what customers actually paid, less what went back to them,
    // whatever happened to the booking (a no-show or a half refund still
    // leaves money with the business).
    const grossCents = counted.reduce((s, b) => s + b.amountPaidCents, 0);
    const refundedCents = counted.reduce((s, b) => s + (b.amountRefundedCents ?? 0), 0);
    const netCents = grossCents - refundedCents;
    const totalGuests = confirmed.reduce((s, b) => s + b.guestCount, 0);
    const unknownParty = confirmed.filter((b) => !b.guestCount).length;

    const slotBreakdown = new Map<string, number>();
    for (const b of confirmed) {
      slotBreakdown.set(b.timeSlot, (slotBreakdown.get(b.timeSlot) ?? 0) + 1);
    }

    return {
      unknownParty,
      total: counted.length,
      confirmed: confirmed.length,
      cancelled: cancelled.length,
      noShow: noShow.length,
      grossCents,
      refundedCents,
      netCents,
      totalGuests,
      slotBreakdown: [...slotBreakdown.entries()].sort((a, b) => b[1] - a[1]),
    };
  }, [rows]);

  function downloadCsv() {
    if (!rows) return;
    const header = [
      'Booking ID',
      'Tour date',
      'Time',
      'Tour',
      'Boat',
      'Guests',
      'Customer',
      'Email',
      'Phone',
      'Status',
      'Payment',
      'Paid (USD)',
      'Refunded (USD)',
      'Kept (USD)',
      'In totals',
      'Stripe payment',
      'Old site booking #',
      'Old site Stripe charge',
    ];
    const csv = [
      header.join(','),
      ...rows.map((b) => {
        // A row the totals leave out (an old-site reschedule's cancelled
        // copy) keeps its money columns blank, so summing the sheet gives
        // the same numbers as the page.
        const counted = countsTowardMoney(b);
        const money = (cents: number) => (counted ? (cents / 100).toFixed(2) : '');
        return [
          b.id,
          b.date,
          quote(slotLabels[b.timeSlot as keyof typeof slotLabels] ?? b.timeSlot),
          quote(b.tourName),
          typeLabel(b.type),
          b.guestCount || '',
          quote(b.customerName),
          quote(b.customerEmail),
          quote(b.customerPhone),
          quote(statusLabel(b)),
          quote(paymentLabel(b)),
          money(b.amountPaidCents),
          money(b.amountRefundedCents ?? 0),
          money(b.amountPaidCents - (b.amountRefundedCents ?? 0)),
          counted ? 'Yes' : 'No',
          b.stripePaymentIntentId ?? '',
          b.legacy?.bookingId ?? '',
          quote(b.legacy?.stripeTransactionIds ?? ''),
        ].join(',');
      }),
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bookings-${from}-to-${to}.csv`;
    a.click();
    // Safari starts the download after click() returns; revoking straight
    // away can cancel it.
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  return (
    <div className="space-y-6">
      <section className="bg-white rounded-2xl border border-[var(--color-ink)]/8 shadow-[var(--shadow-card)] p-5">
        <div className="flex flex-wrap gap-3 items-end">
          <label className="block">
            <span className="block text-sm font-medium mb-1">
              Tours from
            </span>
            <input
              type="date"
              value={from}
              onChange={(e) => { setFrom(e.target.value); setRows(null); }}
              className={inputClass}
            />
          </label>
          <label className="block">
            <span className="block text-sm font-medium mb-1">
              to
            </span>
            <input
              type="date"
              value={to}
              onChange={(e) => { setTo(e.target.value); setRows(null); }}
              className={inputClass}
            />
          </label>
          <button
            type="button"
            onClick={() => run()}
            disabled={loading || !from || !to}
            className="px-5 py-2.5 rounded-[10px] bg-[var(--color-brand-blue)] hover:bg-[var(--color-brand-blue-dark)] text-white font-medium disabled:opacity-60"
          >
            {loading ? 'Loading…' : 'Show report'}
          </button>
          {rows && rows.length > 0 && (
            <button
              type="button"
              onClick={downloadCsv}
              className="px-4 py-2.5 rounded-[10px] border border-[var(--color-ink)]/15 hover:bg-[var(--color-ink)]/5 text-sm"
            >
              Download spreadsheet (CSV)
            </button>
          )}
        </div>
        <p className="mt-3 text-xs text-[var(--color-ink-soft)]">
          Counted by the date of the tour, not the day it was paid.
        </p>
        {error && (
          <div role="alert" className="mt-3 rounded-2xl bg-[var(--color-coral)]/10 border border-[var(--color-coral)]/30 p-3 text-sm">
            {error}
          </div>
        )}
      </section>

      {stats && (
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Stat label="Bookings" value={stats.total} sub={`${stats.confirmed} went ahead or are coming up · ${stats.cancelled} cancelled · ${stats.noShow} no-show`} />
          <Stat label="Guests" value={stats.totalGuests} sub={stats.unknownParty ? `plus ${stats.unknownParty} old-website booking${stats.unknownParty === 1 ? '' : 's'} with no party size` : 'on tours that went ahead or are coming up'} />
          <Stat label="Taken" value={money(stats.grossCents)} sub={`${money(stats.refundedCents)} refunded`} />
          <Stat label="Kept" value={money(stats.netCents)} sub="Taken, less refunds" />
        </div>
      )}

      {stats && stats.slotBreakdown.length > 0 && (
        <section className="bg-white rounded-2xl border border-[var(--color-ink)]/8 shadow-[var(--shadow-card)] p-5">
          <h2 className="font-display text-lg mb-3">Bookings by departure</h2>
          <ul className="space-y-1 text-sm">
            {stats.slotBreakdown.map(([slot, count]) => (
              <li
                key={slot}
                className="flex items-center justify-between gap-2 border-b border-[var(--color-ink)]/8 last:border-0 py-1.5"
              >
                <span>{slotLabels[slot as keyof typeof slotLabels] ?? slot}</span>
                <span className="font-medium">{count}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {rows && rows.length === 0 && (
        <div className="rounded-2xl bg-white border border-[var(--color-ink)]/8 p-6 text-center text-sm text-[var(--color-ink-soft)]">
          No bookings in this date range.
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: number | string;
  sub?: string;
}) {
  return (
    <div className="bg-white rounded-2xl border border-[var(--color-ink)]/8 shadow-[var(--shadow-card)] p-5">
      <p className="text-xs uppercase tracking-widest text-[var(--color-ink-soft)]">
        {label}
      </p>
      <p className="font-display text-3xl text-[var(--color-brand-blue)] leading-tight mt-1">
        {value}
      </p>
      {sub && <p className="text-xs text-[var(--color-ink-soft)] mt-1">{sub}</p>}
    </div>
  );
}

function quote(s: string): string {
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

'use client';

import { useMemo, useState } from 'react';
import {
  listBookingsBetween,
  type BookingDoc,
} from '@/lib/admin-firestore';
import { formatPrice, slotLabels } from '@/lib/tours';
import { isoDate, startOfDay } from '@/lib/date';

const inputClass =
  'rounded-xl border border-[var(--color-ink)]/15 bg-white px-3 py-2 text-base focus:border-[var(--color-brand-blue)] focus:outline-2 focus:outline-[var(--color-brand-blue)]/20';

function monthRange() {
  const now = startOfDay(new Date());
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return { start: isoDate(start), end: isoDate(end) };
}

export function ReportsAdmin() {
  const initial = monthRange();
  const [from, setFrom] = useState(initial.start);
  const [to, setTo] = useState(initial.end);
  const [rows, setRows] = useState<BookingDoc[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      const all = await listBookingsBetween(from, to);
      setRows(all);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load.');
    } finally {
      setLoading(false);
    }
  }

  const stats = useMemo(() => {
    if (!rows) return null;
    const confirmed = rows.filter((b) => b.status === 'confirmed' || b.status === 'completed');
    const cancelled = rows.filter((b) => b.status === 'cancelled');
    const noShow = rows.filter((b) => b.status === 'no-show');
    const grossCents = confirmed.reduce((s, b) => s + b.amountPaidCents, 0);
    const refundedCents = rows.reduce((s, b) => s + (b.amountRefundedCents ?? 0), 0);
    const netCents = grossCents - refundedCents;
    const totalGuests = confirmed.reduce((s, b) => s + b.guestCount, 0);

    const slotBreakdown = new Map<string, number>();
    for (const b of confirmed) {
      slotBreakdown.set(b.timeSlot, (slotBreakdown.get(b.timeSlot) ?? 0) + 1);
    }

    return {
      total: rows.length,
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
      'Date',
      'Slot',
      'Tour',
      'Type',
      'Guests',
      'Customer',
      'Email',
      'Phone',
      'Status',
      'Paid (USD)',
      'Refunded (USD)',
      'Net (USD)',
      'Stripe PI',
    ];
    const csv = [
      header.join(','),
      ...rows.map((b) =>
        [
          b.id,
          b.date,
          b.timeSlot,
          quote(b.tourName),
          b.type,
          b.guestCount,
          quote(b.customerName),
          quote(b.customerEmail),
          quote(b.customerPhone),
          b.status,
          (b.amountPaidCents / 100).toFixed(2),
          ((b.amountRefundedCents ?? 0) / 100).toFixed(2),
          ((b.amountPaidCents - (b.amountRefundedCents ?? 0)) / 100).toFixed(2),
          b.stripePaymentIntentId ?? '',
        ].join(','),
      ),
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bookings-${from}-to-${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <section className="bg-white rounded-2xl border border-[var(--color-ink)]/8 shadow-[var(--shadow-card)] p-5">
        <div className="flex flex-wrap gap-3 items-end">
          <label className="block">
            <span className="block text-xs uppercase tracking-widest text-[var(--color-ink-soft)] mb-1">
              From
            </span>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className={inputClass}
            />
          </label>
          <label className="block">
            <span className="block text-xs uppercase tracking-widest text-[var(--color-ink-soft)] mb-1">
              To
            </span>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className={inputClass}
            />
          </label>
          <button
            type="button"
            onClick={run}
            disabled={loading || !from || !to}
            className="px-5 py-2 rounded-full bg-[var(--color-brand-blue)] hover:bg-[var(--color-brand-blue-dark)] text-white font-medium disabled:opacity-60"
          >
            {loading ? 'Loading…' : 'Run report'}
          </button>
          {rows && rows.length > 0 && (
            <button
              type="button"
              onClick={downloadCsv}
              className="px-4 py-2 rounded-full border border-[var(--color-ink)]/15 hover:bg-[var(--color-ink)]/5 text-sm"
            >
              Download CSV
            </button>
          )}
        </div>
        {error && (
          <div className="mt-3 rounded-2xl bg-[var(--color-coral)]/10 border border-[var(--color-coral)]/30 p-3 text-sm">
            {error}
          </div>
        )}
      </section>

      {stats && (
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Stat label="Bookings" value={stats.total} sub={`${stats.confirmed} confirmed`} />
          <Stat label="Guests" value={stats.totalGuests} sub="across confirmed" />
          <Stat label="Gross revenue" value={formatPrice(stats.grossCents)} sub={`${formatPrice(stats.refundedCents)} refunded`} />
          <Stat label="Net revenue" value={formatPrice(stats.netCents)} sub={`${stats.cancelled} cancelled · ${stats.noShow} no-show`} />
        </div>
      )}

      {stats && stats.slotBreakdown.length > 0 && (
        <section className="bg-white rounded-2xl border border-[var(--color-ink)]/8 shadow-[var(--shadow-card)] p-5">
          <h2 className="font-display text-lg mb-3">Bookings by slot</h2>
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

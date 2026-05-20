'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  listAllBookings,
  type BookingDoc,
} from '@/lib/admin-firestore';
import { formatPrice, slotLabels } from '@/lib/tours';
import { clsx } from '@/lib/clsx';

const STATUS_LABEL: Record<BookingDoc['status'], string> = {
  'pending-payment': 'Pending',
  confirmed: 'Confirmed',
  cancelled: 'Cancelled',
  completed: 'Completed',
  'no-show': 'No-show',
};

const STATUS_CLASS: Record<BookingDoc['status'], string> = {
  'pending-payment': 'bg-[var(--color-coral)]/15 text-[var(--color-coral-dark)]',
  confirmed: 'bg-[var(--color-brand-blue)]/15 text-[var(--color-brand-blue-dark)]',
  cancelled: 'bg-[var(--color-ink)]/10 text-[var(--color-ink-soft)]',
  completed: 'bg-[var(--color-manatee)]/20 text-[var(--color-ink)]',
  'no-show': 'bg-[var(--color-coral)]/10 text-[var(--color-ink-soft)]',
};

const FILTERS: Array<{ value: 'all' | BookingDoc['status']; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'pending-payment', label: 'Pending' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'completed', label: 'Completed' },
  { value: 'no-show', label: 'No-show' },
];

export function BookingsList() {
  const [rows, setRows] = useState<BookingDoc[] | null>(null);
  const [filter, setFilter] = useState<'all' | BookingDoc['status']>('all');
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listAllBookings()
      .then(setRows)
      .catch((err) =>
        setError(err instanceof Error ? err.message : 'Failed to load bookings.'),
      );
  }, []);

  const filtered = (rows ?? []).filter((b) => {
    if (filter !== 'all' && b.status !== filter) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      const haystack =
        `${b.customerName} ${b.customerEmail} ${b.customerPhone} ${b.tourName} ${b.date}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-center justify-between">
        <div className="flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setFilter(f.value)}
              className={clsx(
                'px-3 py-1.5 rounded-full text-xs font-medium border',
                filter === f.value
                  ? 'bg-[var(--color-brand-blue)] text-white border-[var(--color-brand-blue)]'
                  : 'bg-white text-[var(--color-ink)] border-[var(--color-ink)]/15 hover:bg-[var(--color-ink)]/5',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <input
          type="search"
          placeholder="Search name, email, phone, tour…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="rounded-full border border-[var(--color-ink)]/15 bg-white px-4 py-2 text-sm w-full sm:w-72"
        />
      </div>

      {error && (
        <div className="rounded-2xl bg-[var(--color-coral)]/10 border border-[var(--color-coral)]/30 p-3 text-sm">
          {error}
        </div>
      )}

      <div className="bg-white rounded-2xl border border-[var(--color-ink)]/8 shadow-[var(--shadow-card)] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-[var(--color-cream)] text-[var(--color-ink-soft)]">
              <tr>
                <th className="text-left px-4 py-2 font-medium uppercase text-xs tracking-widest">Date</th>
                <th className="text-left px-4 py-2 font-medium uppercase text-xs tracking-widest">Slot</th>
                <th className="text-left px-4 py-2 font-medium uppercase text-xs tracking-widest">Tour</th>
                <th className="text-left px-4 py-2 font-medium uppercase text-xs tracking-widest">Customer</th>
                <th className="text-right px-4 py-2 font-medium uppercase text-xs tracking-widest">Guests</th>
                <th className="text-right px-4 py-2 font-medium uppercase text-xs tracking-widest">Paid</th>
                <th className="text-left px-4 py-2 font-medium uppercase text-xs tracking-widest">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows === null ? (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-[var(--color-ink-soft)] animate-pulse">
                    Loading…
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-[var(--color-ink-soft)]">
                    No bookings match.
                  </td>
                </tr>
              ) : (
                filtered.map((b) => (
                  <tr
                    key={b.id}
                    className="border-t border-[var(--color-ink)]/8 hover:bg-[var(--color-cream)]/40"
                  >
                    <td className="px-4 py-2 font-mono text-xs">{b.date}</td>
                    <td className="px-4 py-2 text-xs">
                      {slotLabels[b.timeSlot as keyof typeof slotLabels] ?? b.timeSlot}
                    </td>
                    <td className="px-4 py-2">
                      <Link
                        href={`/admin/bookings/${b.id}`}
                        className="text-[var(--color-brand-blue)] hover:text-[var(--color-brand-blue-dark)] hover:underline underline-offset-4"
                      >
                        {b.tourName}
                      </Link>
                      <span className="ml-2 text-xs text-[var(--color-ink-soft)]">
                        ({b.type})
                      </span>
                    </td>
                    <td className="px-4 py-2">
                      {b.customerName}
                      <div className="text-xs text-[var(--color-ink-soft)]">{b.customerEmail}</div>
                    </td>
                    <td className="px-4 py-2 text-right">{b.guestCount}</td>
                    <td className="px-4 py-2 text-right font-medium">
                      {formatPrice(b.amountPaidCents)}
                      {b.amountRefundedCents > 0 && (
                        <span className="block text-xs text-[var(--color-coral-dark)]">
                          −{formatPrice(b.amountRefundedCents)}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <span
                        className={clsx(
                          'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium',
                          STATUS_CLASS[b.status],
                        )}
                      >
                        {STATUS_LABEL[b.status]}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

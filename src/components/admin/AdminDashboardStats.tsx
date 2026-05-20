import Link from 'next/link';
import { fetchDashboardStats, type BookingTotals } from '@/lib/admin-stats-server';
import { formatPrice, slotLabels } from '@/lib/tours';
import { formatFriendlyDate } from '@/lib/date';

function StatTile({
  label,
  totals,
}: {
  label: string;
  totals: BookingTotals;
}) {
  return (
    <div className="bg-white rounded-2xl border border-[var(--color-ink)]/8 shadow-[var(--shadow-card)] p-4">
      <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-soft)] font-medium">
        {label}
      </p>
      <p className="mt-2 font-display text-3xl text-[var(--color-brand-blue)] leading-none">
        {formatPrice(totals.grossCents)}
      </p>
      <p className="mt-2 text-xs text-[var(--color-ink-soft)]">
        {totals.count} {totals.count === 1 ? 'booking' : 'bookings'}
        {totals.guests > 0 && (
          <>
            {' '}· {totals.guests} {totals.guests === 1 ? 'guest' : 'guests'}
          </>
        )}
      </p>
    </div>
  );
}

export async function AdminDashboardStats() {
  const stats = await fetchDashboardStats();

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
      <StatTile label="Today" totals={stats.today} />
      <StatTile label="This week" totals={stats.thisWeek} />
      <StatTile label="This month" totals={stats.thisMonth} />

      <div className="bg-[var(--color-brand-blue)] text-white rounded-2xl shadow-[var(--shadow-card)] p-4">
        <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-cream)] font-medium">
          Next tour
        </p>
        {stats.nextTour ? (
          <Link
            href={`/admin/bookings/${stats.nextTour.bookingId}`}
            className="block mt-1 group"
          >
            <p className="font-display text-xl leading-tight">
              {formatFriendlyDate(stats.nextTour.date).split(',')[0]}
            </p>
            <p className="text-xs text-white/85 mt-1">
              {slotLabels[stats.nextTour.timeSlot as keyof typeof slotLabels] ??
                stats.nextTour.timeSlot}
              {' · '}
              {stats.nextTour.customerName} ({stats.nextTour.guestCount})
            </p>
            <p className="mt-2 text-[10px] text-white/70 group-hover:text-white">
              Open booking →
            </p>
          </Link>
        ) : (
          <p className="mt-2 text-sm text-white/85">
            Nothing on the books yet.
          </p>
        )}
      </div>
    </div>
  );
}

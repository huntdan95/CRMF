import Link from 'next/link';
import {
  fetchDashboardStats,
  type BookingTotals,
  type Departure,
} from '@/lib/admin-stats-server';
import { formatPrice } from '@/lib/tours';
import { formatFriendlyDate } from '@/lib/date';

/** "5 guests", or a plain note when old-site bookings left the count unknown. */
function guestsText(n: number): string {
  return n > 0 ? `${n} ${n === 1 ? 'guest' : 'guests'}` : 'party size not recorded';
}

function StatTile({ label, totals }: { label: string; totals: BookingTotals }) {
  return (
    <div className="bg-white rounded-2xl border border-[var(--color-line)] shadow-[var(--shadow-panel)] p-4">
      <p className="text-xs uppercase tracking-[0.14em] text-[var(--color-ink-soft)] font-medium">
        {label}
      </p>
      <p className="mt-1 text-display text-[1.75rem] tabular-nums text-[var(--color-spring)]">
        {totals.guests} {totals.guests === 1 ? 'guest' : 'guests'}
      </p>
      <p className="mt-1 text-sm text-[var(--color-ink-soft)]">
        {totals.count} {totals.count === 1 ? 'booking' : 'bookings'} · {formatPrice(totals.keptCents)}
      </p>
    </div>
  );
}

function DepartureCard({ dep }: { dep: Departure }) {
  return (
    <li className="bg-white rounded-2xl border border-[var(--color-line)] shadow-[var(--shadow-panel)] p-4">
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-display text-lg">{dep.startTime}</p>
        <p className="text-sm font-medium">
          {guestsText(dep.guests)}
          {dep.type === 'private' && <span className="text-[var(--color-ink-soft)] font-normal"> · private</span>}
        </p>
      </div>
      <p className="text-sm text-[var(--color-ink-soft)]">{dep.tourName}</p>
      <ul className="mt-2 divide-y divide-[var(--color-ink)]/8">
        {dep.bookings.map((b) => (
          <li key={b.id} className="py-2 flex items-center justify-between gap-3">
            <Link href={`/admin/bookings/${b.id}`} className="min-w-0 flex-1 py-1">
              <span className="block font-medium truncate text-[var(--color-brand-blue)]">{b.customerName}</span>
              <span className="block text-xs text-[var(--color-ink-soft)]">
                {b.guestCount ? `${b.guestCount} ${b.guestCount === 1 ? 'guest' : 'guests'}` : 'party size not recorded'}
                {b.oldSiteDeposit && ' · deposit paid on old site'}
              </span>
            </Link>
            {b.customerPhone && (
              <a
                href={`tel:${b.customerPhone.replace(/[^\d+]/g, '')}`}
                className="shrink-0 inline-flex items-center justify-center h-11 px-4 rounded-[10px] border border-[var(--color-ink)]/15 text-sm font-semibold text-[var(--color-brand-blue)]"
                aria-label={`Call ${b.customerName}`}
              >
                Call
              </a>
            )}
          </li>
        ))}
      </ul>
    </li>
  );
}

function DayList({ title, deps, emptyText }: { title: string; deps: Departure[]; emptyText: string }) {
  return (
    <section>
      <h2 className="font-display text-xl mb-2">{title}</h2>
      {deps.length === 0 ? (
        <p className="text-sm text-[var(--color-ink-soft)] bg-white rounded-2xl border border-[var(--color-line)] p-4">{emptyText}</p>
      ) : (
        <ul className="space-y-3">
          {deps.map((d) => <DepartureCard key={`${d.date}|${d.timeSlot}`} dep={d} />)}
        </ul>
      )}
    </section>
  );
}

export async function AdminDashboardStats() {
  const stats = await fetchDashboardStats();
  const { today, tomorrow, todayIso, tomorrowIso } = stats.todayAndTomorrow;

  if (!stats.ok) {
    return (
      <div role="alert" className="rounded-2xl bg-[var(--color-coral)]/10 border border-[var(--color-coral)]/30 p-4 mb-8 text-sm">
        Couldn’t load today’s numbers. Pull down to refresh. The calendar below may still work.
      </div>
    );
  }

  return (
    <div className="space-y-8 mb-8">
      <div className="grid lg:grid-cols-2 gap-6">
        <DayList
          title={`Today · ${formatFriendlyDate(todayIso).split(',')[0]}`}
          deps={today}
          emptyText="No tours today."
        />
        <DayList
          title={`Tomorrow · ${formatFriendlyDate(tomorrowIso).split(',')[0]}`}
          deps={tomorrow}
          emptyText="No tours tomorrow."
        />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-[var(--color-spring-deep)] text-white rounded-2xl p-4 col-span-2 lg:col-span-1">
          <p className="text-xs uppercase tracking-[0.14em] text-[var(--color-spring-bright)] font-semibold">
            Next tour out
          </p>
          {stats.next ? (
            <Link href={`/admin/bookings/${stats.next.bookings[0]!.id}`} className="block mt-1 group">
              <p className="font-display text-xl leading-tight">
                {stats.next.date === todayIso
                  ? 'Today'
                  : stats.next.date === tomorrowIso
                    ? 'Tomorrow'
                    : formatFriendlyDate(stats.next.date).split(',').slice(0, 2).join(',')}
                , {stats.next.startTime}
              </p>
              <p className="text-sm text-white/85 mt-1">
                {stats.next.bookings.length === 1
                  ? stats.next.bookings[0]!.customerName
                  : `${stats.next.bookings.length} bookings`}
                {' · '}
                {guestsText(stats.next.guests)}
              </p>
              <p className="mt-2 text-xs text-white/70 group-hover:text-white">Open booking →</p>
            </Link>
          ) : (
            <p className="mt-2 text-sm text-white/85">Nothing booked yet.</p>
          )}
        </div>
        <StatTile label="Today" totals={stats.today} />
        <StatTile label="This week" totals={stats.thisWeek} />
        <StatTile label="This month" totals={stats.thisMonth} />
      </div>
    </div>
  );
}

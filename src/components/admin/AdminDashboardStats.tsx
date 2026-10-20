import Link from 'next/link';
import {
  fetchDashboardStats,
  type AwaitingChoice,
  type BookingTotals,
  type ClosedStillBooked,
  type Departure,
} from '@/lib/admin-stats-server';
import { formatPrice } from '@/lib/tours';
import { formatFriendlyDate, parseIsoDate } from '@/lib/date';
import { clsx } from '@/lib/clsx';
import { TripCrewSwitch } from './TripCrewSwitch';
import { Badge, PanelHeader, buttonClass, panelClass } from './ui';

/** Close a day, opened on `date` with Weather picked. */
export function weatherCancelHref(date: string): string {
  return `/admin/blackouts?date=${date}&reason=weather`;
}

/** "Sat, Oct 17" */
function shortDay(iso: string): string {
  const d = parseIsoDate(iso);
  return d ? d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : iso;
}

/**
 * "5 guests". Old-site bookings with no party size on file aren't in the
 * count, so as in the crew app it reads "4+ guests", or "party size
 * unknown" when none are known.
 */
function guestsText(n: number, unknownParty: number): string {
  if (unknownParty === 0) return `${n} ${n === 1 ? 'guest' : 'guests'}`;
  return n > 0 ? `${n}+ guests` : 'party size unknown';
}

function StatTile({ label, totals }: { label: string; totals: BookingTotals }) {
  return (
    <div className="bg-white rounded-2xl border border-[var(--color-line)] shadow-[var(--shadow-panel)] p-4">
      <p className="text-xs uppercase tracking-[0.14em] text-[var(--color-ink-soft)] font-medium">
        {label}
      </p>
      <p className="mt-1 text-display text-[1.75rem] tabular-nums text-[var(--color-spring)]">
        {/* The big number: "14+", or "?" when no party size is known, as on the crew's trip cards. */}
        {totals.unknownParty === 0 ? totals.guests : totals.guests > 0 ? `${totals.guests}+` : '?'}{' '}
        {totals.guests === 1 && totals.unknownParty === 0 ? 'guest' : 'guests'}
      </p>
      <p className="mt-1 text-sm text-[var(--color-ink-soft)]">
        {totals.count} {totals.count === 1 ? 'booking' : 'bookings'} · {formatPrice(totals.keptCents)}
      </p>
    </div>
  );
}

const CLOSED_TEXT: Record<NonNullable<Departure['closed']>['kind'], string> = {
  cancelled: 'Not going out',
  closing: 'Closing: undo still open',
  'closed-booked': 'Closed, still booked: contact them',
};

function DepartureCard({ dep }: { dep: Departure }) {
  const off = dep.closed?.kind === 'cancelled';
  return (
    <li
      className={clsx(
        'rounded-2xl border p-4',
        dep.closed
          ? 'bg-[var(--color-paper)] border-dashed border-[var(--color-line-strong)]'
          : 'bg-white border-[var(--color-line)] shadow-[var(--shadow-panel)]',
      )}
    >
      <div className="flex items-baseline justify-between gap-3">
        <p className={clsx('font-display text-lg', off && 'line-through text-[var(--color-ink-soft)]')}>{dep.startTime}</p>
        <p className="text-sm font-medium">
          {guestsText(dep.guests, dep.unknownParty)}
          {dep.type === 'private' && <span className="text-[var(--color-ink-soft)] font-normal"> · private</span>}
        </p>
      </div>
      {dep.closed && (
        <p className="mt-1">
          <Badge tone="buoy">{CLOSED_TEXT[dep.closed.kind]}{dep.closed.reason === 'weather' ? ' (weather)' : ''}</Badge>
        </p>
      )}
      <p className="text-sm text-[var(--color-ink-soft)]">{dep.tourName}</p>
      {!off && dep.closed?.kind !== 'closing' && (
        <TripCrewSwitch
          date={dep.date}
          timeSlot={dep.timeSlot}
          time={dep.startTime}
          noCrew={dep.noCrew}
        />
      )}
      <ul className="mt-2 divide-y divide-[var(--color-ink)]/8">
        {dep.bookings.map((b) => (
          <li key={b.id} className="py-2 flex items-center justify-between gap-3">
            <Link href={`/admin/bookings/${b.id}`} className="min-w-0 flex-1 py-1">
              <span className="block font-medium truncate text-[var(--color-brand-blue)]">{b.customerName}</span>
              <span className="block text-xs text-[var(--color-ink-soft)]">
                {b.guestCount ? `${b.guestCount} ${b.guestCount === 1 ? 'guest' : 'guests'}` : 'party size not recorded'}
                {b.oldSiteDeposit && ' · deposit paid on old site'}
                {b.awaitingChoice && ' · picking a new date or a refund'}
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

function DayList({
  title,
  deps,
  emptyText,
  date,
}: {
  title: string;
  deps: Departure[];
  emptyText: string;
  date: string;
}) {
  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="font-display text-xl">{title}</h2>
        <Link href={weatherCancelHref(date)} className={clsx(buttonClass('secondary', 'sm'), 'shrink-0 text-[var(--color-coral-dark)]')}>
          Weather cancel
        </Link>
      </div>
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

/** Closed departures whose customers haven't picked a new date or a refund yet. */
function AwaitingChoiceCard({ list, todayIso }: { list: AwaitingChoice[]; todayIso: string }) {
  if (list.length === 0) return null;
  return (
    <section className={clsx(panelClass, 'overflow-hidden')}>
      <PanelHeader
        title="Waiting on customers"
        description="You closed these trips. Each customer is picking a new date or a refund. Anyone who doesn’t by the deadline is refunded automatically the next morning."
        aside={<Badge tone="buoy">{list.length}</Badge>}
      />
      <ul className="divide-y divide-[var(--color-line)]">
        {list.map((b) => {
          const overdue = b.decideBy < todayIso;
          return (
            <li key={b.id} className="px-5 py-3 flex items-center gap-3">
              <Link href={`/admin/bookings/${b.id}`} className="min-w-0 flex-1 py-1">
                <span className="block font-medium truncate text-[var(--color-brand-blue)]">{b.customerName || 'No name on file'}</span>
                <span className="block text-xs text-[var(--color-ink-soft)]">
                  Was {shortDay(b.date)}, {b.startTime} · {b.guestCount ? `${b.guestCount} ${b.guestCount === 1 ? 'guest' : 'guests'}` : 'party size not recorded'}
                </span>
                <span className={clsx('block text-xs font-medium', overdue ? 'text-[var(--color-coral-dark)]' : 'text-[var(--color-ink)]')}>
                  {overdue ? 'Deadline passed: refunding at 6 AM' : `Deadline ${shortDay(b.decideBy)}`}
                  {b.remindedAt && ' · reminded'}
                  {b.oldSite && ' · old website: you refund it'}
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
          );
        })}
      </ul>
    </section>
  );
}

/**
 * Bookings Travis left on a departure he closed, once its date has passed:
 * Today and Tomorrow no longer show them, and they still read as confirmed.
 */
function ClosedStillBookedCard({ list }: { list: ClosedStillBooked[] }) {
  if (list.length === 0) return null;
  return (
    <section className={clsx(panelClass, 'overflow-hidden')}>
      <PanelHeader
        title="Closed, still booked"
        description="You closed these trips and left them booked, so they didn’t go out. Move each one to another day, or cancel it to refund them in full. If one went ahead after all, reopen the day under Close a day, then mark it."
        aside={<Badge tone="buoy">{list.length}</Badge>}
      />
      <ul className="divide-y divide-[var(--color-line)]">
        {list.map((b) => (
          <li key={b.id} className="px-5 py-3 flex items-center gap-3">
            <Link href={`/admin/bookings/${b.id}`} className="min-w-0 flex-1 py-1">
              <span className="block font-medium truncate text-[var(--color-brand-blue)]">{b.customerName || 'No name on file'}</span>
              <span className="block text-xs text-[var(--color-ink-soft)]">
                Was {shortDay(b.date)}, {b.startTime} · {b.guestCount ? `${b.guestCount} ${b.guestCount === 1 ? 'guest' : 'guests'}` : 'party size not recorded'}
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
          date={todayIso}
        />
        <DayList
          title={`Tomorrow · ${formatFriendlyDate(tomorrowIso).split(',')[0]}`}
          deps={tomorrow}
          emptyText="No tours tomorrow."
          date={tomorrowIso}
        />
      </div>

      <AwaitingChoiceCard list={stats.awaitingChoice} todayIso={todayIso} />
      <ClosedStillBookedCard list={stats.closedStillBooked} />

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
                {guestsText(stats.next.guests, stats.next.unknownParty)}
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

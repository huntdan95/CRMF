import Link from 'next/link';
import type { UpcomingDeparture } from '@/lib/availability-server';
import { bookingHref, marinaNow } from '@/lib/availability';
import { formatPrice, slotOrder, tours } from '@/lib/tours';
import { ArrowRight } from '@/components/ui/icons';
import { clsx } from '@/lib/clsx';

function dayLabel(iso: string, today: string) {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y!, m! - 1, d!);
  const [ty, tm, td] = today.split('-').map(Number);
  const diff = Math.round((date.getTime() - new Date(ty!, tm! - 1, td!).getTime()) / 86_400_000);
  const weekday = date.toLocaleDateString('en-US', { weekday: 'short' });
  const md = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  if (diff === 0) return { top: 'Today', bottom: md };
  if (diff === 1) return { top: 'Tomorrow', bottom: md };
  return { top: weekday, bottom: md };
}

const sharedSeat = tours.find((t) => t.type === 'shared')?.pricePerPerson ?? 0;
const privateBoat = tours.find((t) => t.type === 'private' && t.timeSlot !== 'whole-day')?.flatPrice ?? 0;

/**
 * The next bookable departures, straight from the booking calendar — or,
 * when availability can't be read, the daily schedule.
 */
export function DeparturesBoard({ departures }: { departures: UpcomingDeparture[] | null }) {
  const today = marinaNow().date;

  if (!departures || departures.length === 0) {
    const rows = slotOrder.map((slot) => ({
      shared: tours.find((t) => t.timeSlot === slot && t.type === 'shared')!,
      private: tours.find((t) => t.timeSlot === slot && t.type === 'private')!,
    }));
    return (
      <div className="overflow-hidden rounded-2xl border border-[var(--color-sand)] bg-white">
        <div className="grid grid-cols-[1fr_1fr] gap-4 border-b border-[var(--color-sand)] px-5 py-3 text-label text-[var(--color-ink-soft)] sm:grid-cols-[12rem_1fr_1fr] sm:px-7">
          <span>Departs</span>
          <span className="hidden sm:block">Shared boat</span>
          <span className="hidden sm:block">Private boat</span>
        </div>
        <ul className="divide-y divide-[var(--color-sand)]">
          {rows.map((r) => (
            <li
              key={r.shared.slug}
              className="grid grid-cols-2 items-center gap-x-4 gap-y-3 px-5 py-4 sm:grid-cols-[12rem_1fr_1fr] sm:px-7"
            >
              <p className="col-span-2 flex items-baseline gap-3 sm:col-span-1 sm:block">
                <span className="block whitespace-nowrap text-display text-[1.5rem] tabular-nums">
                  {r.shared.startTimeDisplay}
                </span>
                <span className="whitespace-nowrap text-sm text-[var(--color-ink-soft)]">
                  back {r.shared.endTimeDisplay}
                </span>
              </p>
              <BoardCell href={bookingHref(r.shared)} open title={`${formatPrice(sharedSeat)} a seat`} note="Shared, up to 6" />
              <BoardCell href={bookingHref(r.private)} open title={`${formatPrice(privateBoat)} the boat`} note="Private, up to 6" />
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--color-sand)] bg-white">
      <div className="hidden grid-cols-[9rem_9rem_1fr_1fr] gap-6 border-b border-[var(--color-sand)] px-7 py-3 text-label text-[var(--color-ink-soft)] md:grid">
        <span>Day</span>
        <span>Departs</span>
        <span>Shared · {formatPrice(sharedSeat)} a seat</span>
        <span>Private · {formatPrice(privateBoat)} the boat</span>
      </div>
      <ul className="divide-y divide-[var(--color-sand)]">
        {departures.map((d) => {
          const label = dayLabel(d.date, today);
          const few = d.seatsLeft > 0 && d.seatsLeft <= 2;
          return (
            <li
              key={`${d.date}-${d.shared.timeSlot}`}
              className="grid grid-cols-[auto_1fr] items-center gap-x-5 gap-y-3 px-5 py-4 md:grid-cols-[9rem_9rem_1fr_1fr] md:gap-6 md:px-7"
            >
              <p className="leading-tight">
                <span className="block font-semibold">{label.top}</span>
                <span className="block text-sm text-[var(--color-ink-soft)]">{label.bottom}</span>
              </p>
              <p className="whitespace-nowrap text-display text-[1.5rem] tabular-nums md:text-[1.6rem]">{d.shared.startTimeDisplay}</p>
              <div className="col-span-2 grid grid-cols-2 gap-2 md:gap-6">
                <BoardCell
                  href={bookingHref(d.shared, { date: d.date })}
                  open={d.seatsLeft > 0}
                  title={d.seatsLeft > 0 ? `${d.seatsLeft} ${d.seatsLeft === 1 ? 'seat' : 'seats'} left` : 'Sold out'}
                  note={few ? 'Almost full' : 'Shared boat'}
                  urgent={few}
                />
                <BoardCell
                  href={bookingHref(d.private, { date: d.date })}
                  open={d.privateOpen}
                  title={d.privateOpen ? 'Available' : 'Not available'}
                  note="Whole boat"
                />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function BoardCell({
  href,
  open,
  title,
  note,
  urgent,
}: {
  href: string;
  open: boolean;
  title: string;
  note: string;
  urgent?: boolean;
}) {
  if (!open) {
    return (
      <div className="rounded-lg bg-[var(--color-paper)] px-3.5 py-2.5 text-[var(--color-ink-soft)]">
        <p className="text-sm font-semibold">{title}</p>
        <p className="text-xs">{note}</p>
      </div>
    );
  }
  return (
    <Link
      href={href}
      className="group flex items-center justify-between gap-3 rounded-lg border border-[var(--color-sand)] px-3.5 py-2.5 transition-colors hover:border-[var(--color-ink)] hover:bg-[var(--color-ink)] hover:text-white"
    >
      <span>
        <span
          className={clsx(
            'block text-sm font-semibold',
            urgent && 'text-[var(--color-buoy-deep)] group-hover:text-[var(--color-buoy)]',
          )}
        >
          {title}
        </span>
        <span className="block text-xs text-[var(--color-ink-soft)] group-hover:text-white/70">{note}</span>
      </span>
      <ArrowRight
        size={16}
        className="shrink-0 text-[var(--color-ink-soft)] transition-transform group-hover:translate-x-0.5 group-hover:text-[var(--color-buoy)]"
      />
    </Link>
  );
}

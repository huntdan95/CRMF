'use client';

import { useState } from 'react';
import type { CrewDeparture } from '@/lib/crew-server';
import { slotLabels, tours } from '@/lib/tours';
import { clsx } from '@/lib/clsx';
import { dayHeading, daysFrom, formatDay } from './day-label';

function startOf(departure: CrewDeparture): string {
  return (
    tours.find((t) => t.id === departure.tourId)?.startTime ??
    tours.find((t) => t.timeSlot === departure.timeSlot)?.startTime ??
    '00:00'
  );
}

function times(departure: CrewDeparture): { start: string; end: string } {
  const tour =
    tours.find((t) => t.id === departure.tourId) ??
    tours.find((t) => t.timeSlot === departure.timeSlot);
  return { start: tour?.startTimeDisplay ?? '', end: tour?.endTimeDisplay ?? '' };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Who on the boat still needs a signed waiver: no one boards without one. */
function WaiverStatus({ waivers }: { waivers: CrewDeparture['waivers'] }) {
  const done = waivers.signed >= waivers.needed;
  const still = [...waivers.missing];
  if (waivers.unnamed > 0) still.push(`${waivers.unnamed} unnamed guest${waivers.unnamed === 1 ? '' : 's'}`);
  return (
    <div
      className={
        done
          ? 'mt-3 border-t border-[var(--color-ink)]/8 pt-2 text-sm text-[var(--color-spring)]'
          : 'mt-3 border-t border-[var(--color-ink)]/8 pt-2 text-sm text-[var(--color-coral-dark)]'
      }
    >
      <p className="font-semibold">
        {done ? '✓ All waivers signed' : `Waivers: ${waivers.signed} of ${waivers.needed} signed`}
      </p>
      {!done && (
        <p className="mt-0.5 text-[var(--color-ink)]">
          Still to sign: {still.join(', ')}
        </p>
      )}
    </div>
  );
}

/** "Cancelled: weather", "Closed", "Being called off: boat". */
function offLabel(off: NonNullable<CrewDeparture['off']>): { tag: string; note: string } {
  const why = off.reason === 'weather' ? ': weather' : off.reason === 'maintenance' ? ': boat' : '';
  switch (off.kind) {
    case 'cancelled':
      return { tag: `Cancelled${why}`, note: 'Not going out' };
    case 'closing':
      return { tag: `Being called off${why}`, note: 'Travis is calling this off. You’ll get a message when it’s final' };
    case 'closed-booked':
      return { tag: `Closed${why}`, note: 'Closed to new bookings. Travis is contacting the guests, so check with him' };
  }
}

/** Not going out, or about to be called off. */
const calledOff = (dep: CrewDeparture) => dep.off?.kind === 'cancelled' || dep.off?.kind === 'closing';

/**
 * Confirmed upcoming departures, one day at a time: a strip of the days
 * with tours (a dot per boat going out) and that day's boats under it.
 * Shared tours with several bookings show as one boat with the combined
 * headcount. Trips Travis is running solo stay on the list, faded (a hollow
 * dot in the strip), so the crew can see they're off. Departures Travis
 * closed stay too, marked (a grey dot), and struck through once cancelled.
 */
export function CrewSchedule({
  departures,
  today,
}: {
  departures: CrewDeparture[];
  today: string;
}) {
  const [picked, setPicked] = useState<string | null>(null);

  if (departures.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-[var(--color-ink)]/15 p-8 text-center">
        <p className="font-semibold">No confirmed tours coming up</p>
        <p className="mt-1 text-sm text-[var(--color-ink-soft)]">
          New bookings show up here as soon as they’re paid.
        </p>
      </div>
    );
  }

  const sorted = [...departures].sort(
    (a, b) => a.date.localeCompare(b.date) || startOf(a).localeCompare(startOf(b)),
  );
  const days = new Map<string, CrewDeparture[]>();
  for (const dep of sorted) days.set(dep.date, [...(days.get(dep.date) ?? []), dep]);
  const dates = [...days.keys()];
  // A refresh can drop the picked day (its last booking cancelled, or it's
  // in the past now); fall back to the first day with tours.
  const selected = picked && days.has(picked) ? picked : dates[0]!;
  const list = days.get(selected)!;
  const heading = dayHeading(selected, today);
  const going = list.filter((dep) => !calledOff(dep));
  const guests = going.reduce((sum, dep) => sum + dep.guests, 0);
  // Month names between the chips only help once the strip runs past one.
  const months = new Set(dates.map((d) => d.slice(0, 7)));

  return (
    <div className="space-y-4">
      <div className="-mx-4 snap-x scroll-px-4 overflow-x-auto px-4 pt-1 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <ul className="flex w-max items-stretch gap-2" aria-label="Days with tours">
          {dates.map((date, i) => {
            const active = date === selected;
            const deps = days.get(date)!;
            const dayHead = dayHeading(date, today);
            const newMonth = months.size > 1 && date.slice(0, 7) !== dates[i - 1]?.slice(0, 7);
            return (
              <li key={date} className="flex snap-start items-stretch gap-2">
                {newMonth && (
                  <span
                    aria-hidden
                    className="text-label rotate-180 self-center text-[var(--color-ink-soft)] [writing-mode:vertical-rl]"
                  >
                    {formatDay(date, { month: 'short' })}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => setPicked(date)}
                  aria-pressed={active}
                  aria-label={`${dayHead.lead}, ${dayHead.date}: ${plural(deps.length, 'tour', 'tours')}`}
                  className={clsx(
                    'flex w-14 flex-col items-center rounded-2xl border py-2 transition-colors',
                    active
                      ? 'border-transparent bg-[var(--color-spring-deep)] text-white'
                      : 'border-[var(--color-ink)]/8 bg-white shadow-[var(--shadow-card)]',
                  )}
                >
                  <span
                    className={clsx(
                      'text-[0.65rem] font-semibold uppercase tracking-[0.08em]',
                      active ? 'text-white/80' : 'text-[var(--color-ink-soft)]',
                    )}
                  >
                    {daysFrom(today, date) === 0 ? 'Today' : formatDay(date, { weekday: 'short' })}
                  </span>
                  <span className="mt-0.5 text-xl font-bold leading-tight">
                    {formatDay(date, { day: 'numeric' })}
                  </span>
                  <span className="mt-1 flex h-1.5 gap-1">
                    {deps.map((dep) => (
                      <span
                        key={dep.timeSlot}
                        className={clsx(
                          'h-1.5 w-1.5 rounded-full',
                          dep.off
                            ? active
                              ? 'bg-white/35'
                              : 'bg-[var(--color-ink)]/25'
                            : dep.noCrew
                            ? active
                              ? 'ring-1 ring-[var(--color-spring-bright)] ring-inset'
                              : 'ring-1 ring-[var(--color-spring)] ring-inset'
                            : active
                              ? 'bg-[var(--color-spring-bright)]'
                              : 'bg-[var(--color-spring)]',
                        )}
                      />
                    ))}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <section aria-label={`${heading.lead}, ${heading.date}`}>
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <h2 className="flex items-baseline gap-2">
            <span className="text-display text-lg">{heading.lead}</span>
            <span className="text-sm text-[var(--color-ink-soft)]">{heading.date}</span>
          </h2>
          <p className="shrink-0 text-sm text-[var(--color-ink-soft)]">
            {going.length > 0
              ? `${plural(going.length, 'tour', 'tours')} · ${plural(guests, 'guest', 'guests')}`
              : 'Called off'}
          </p>
        </div>
        <ul className="space-y-2">
          {list.map((dep) => {
            const { start, end } = times(dep);
            if (dep.off) {
              const { tag, note } = offLabel(dep.off);
              const struck = dep.off.kind === 'cancelled';
              return (
                <li
                  key={dep.timeSlot}
                  className="flex items-center gap-4 rounded-2xl border border-dashed border-[var(--color-ink)]/25 bg-[var(--color-ink)]/[0.04] p-4"
                >
                  <div className="min-w-0 flex-1">
                    <p className={clsx('text-lg font-bold leading-tight text-[var(--color-ink-soft)]', struck && 'line-through')}>
                      {start}
                    </p>
                    <p className="mt-1 inline-flex rounded-full bg-[var(--color-ink)] px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide text-white">
                      {tag}
                    </p>
                    <p className="mt-1.5 text-sm text-[var(--color-ink-soft)]">
                      {slotLabels[dep.timeSlot]} · {note}.
                    </p>
                  </div>
                  <div className="shrink-0 text-right text-[var(--color-ink-soft)]">
                    <p className={clsx('text-2xl font-bold leading-none', struck && 'line-through')}>{dep.guests}</p>
                    <p className="mt-1 text-xs">{dep.guests === 1 ? 'guest' : 'guests'}</p>
                  </div>
                </li>
              );
            }
            return (
              <li
                key={dep.timeSlot}
                className={clsx(
                  'rounded-2xl p-4',
                  dep.noCrew
                    ? 'border border-dashed border-[var(--color-ink)]/20 text-[var(--color-ink-soft)]'
                    : 'border border-[var(--color-ink)]/8 bg-white shadow-[var(--shadow-card)]',
                )}
              >
                <div className="flex items-center gap-4">
                  <div className="min-w-0 flex-1">
                    {dep.noCrew && (
                      <p className="mb-1.5 text-sm font-semibold text-[var(--color-ink)]">
                        No crew needed. Travis is running this one solo.
                      </p>
                    )}
                    <p className="text-lg font-bold leading-tight">{start}</p>
                    <p className="text-xs text-[var(--color-ink-soft)]">until {end}</p>
                    <p className="mt-1.5 text-sm">
                      {slotLabels[dep.timeSlot]}
                      <span
                        className={
                          dep.type === 'private'
                            ? 'ml-2 rounded-full bg-[var(--color-spring-deep)] px-2 py-0.5 text-xs font-semibold text-white'
                            : 'ml-2 rounded-full bg-[var(--color-mist)] px-2 py-0.5 text-xs font-semibold text-[var(--color-spring)]'
                        }
                      >
                        {dep.type === 'private' ? 'Private' : 'Shared'}
                      </span>
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-2xl font-bold leading-none">{dep.guests}</p>
                    <p className="mt-1 text-xs text-[var(--color-ink-soft)]">
                      {dep.guests === 1 ? 'guest' : 'guests'}
                      {dep.bookings > 1 && ` · ${dep.bookings} bookings`}
                    </p>
                  </div>
                </div>
                <WaiverStatus waivers={dep.waivers} />
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

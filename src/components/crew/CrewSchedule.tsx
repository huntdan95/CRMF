import type { CrewDeparture } from '@/lib/crew-server';
import { slotLabels, tours } from '@/lib/tours';
import { clsx } from '@/lib/clsx';

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

function dayHeading(iso: string, today: string): { lead: string; date: string } {
  const [y, m, d] = iso.split('-').map(Number);
  const [ty, tm, td] = today.split('-').map(Number);
  const diff = Math.round(
    (Date.UTC(y!, m! - 1, d!) - Date.UTC(ty!, tm! - 1, td!)) / 86_400_000,
  );
  const date = new Date(Date.UTC(y!, m! - 1, d!));
  const fmt = (opts: Intl.DateTimeFormatOptions) =>
    date.toLocaleDateString('en-US', { ...opts, timeZone: 'UTC' });
  const lead =
    diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : fmt({ weekday: 'long' });
  return { lead, date: fmt({ month: 'short', day: 'numeric' }) };
}

/**
 * Confirmed upcoming departures grouped by day. Shared tours with several
 * bookings show as one boat with the combined headcount. Trips Travis is
 * running solo stay on the list, faded, so the crew can see they're off.
 */
export function CrewSchedule({
  departures,
  today,
}: {
  departures: CrewDeparture[];
  today: string;
}) {
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

  return (
    <div className="space-y-6">
      {[...days.entries()].map(([date, list]) => {
        const heading = dayHeading(date, today);
        return (
          <section key={date} aria-label={`${heading.lead}, ${heading.date}`}>
            <h2 className="mb-2 flex items-baseline gap-2">
              <span className="text-display text-lg">{heading.lead}</span>
              <span className="text-sm text-[var(--color-ink-soft)]">{heading.date}</span>
            </h2>
            <ul className="space-y-2">
              {list.map((dep) => {
                const { start, end } = times(dep);
                return (
                  <li
                    key={dep.timeSlot}
                    className={clsx(
                      'flex items-center gap-4 rounded-2xl p-4',
                      dep.noCrew
                        ? 'border border-dashed border-[var(--color-ink)]/20 text-[var(--color-ink-soft)]'
                        : 'border border-[var(--color-ink)]/8 bg-white shadow-[var(--shadow-card)]',
                    )}
                  >
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
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

import type { CrewDeparture } from '@/lib/crew-server';
import { slotLabels, tours } from '@/lib/tours';

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

const OFF_LABEL: Record<'weather' | 'maintenance' | 'none', string> = {
  weather: 'Cancelled: weather',
  maintenance: 'Cancelled: boat',
  none: 'Cancelled',
};

/**
 * Confirmed upcoming departures grouped by day. Shared tours with several
 * bookings show as one boat with the combined headcount. Departures Travis
 * closed stay on the list, struck through and marked cancelled.
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
                if (dep.off) {
                  return (
                    <li
                      key={dep.timeSlot}
                      className="flex items-center gap-4 rounded-2xl border border-dashed border-[var(--color-ink)]/25 bg-[var(--color-ink)]/[0.04] p-4"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-lg font-bold leading-tight text-[var(--color-ink-soft)] line-through">{start}</p>
                        <p className="mt-1 inline-flex rounded-full bg-[var(--color-ink)] px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide text-white">
                          {OFF_LABEL[dep.off.reason ?? 'none']}
                        </p>
                        <p className="mt-1.5 text-sm text-[var(--color-ink-soft)]">
                          {slotLabels[dep.timeSlot]} · not going out
                          {dep.off.kind === 'moving' && '. Guests are picking a new date'}
                        </p>
                      </div>
                      <div className="shrink-0 text-right text-[var(--color-ink-soft)]">
                        <p className="text-2xl font-bold leading-none line-through">{dep.guests}</p>
                        <p className="mt-1 text-xs">{dep.guests === 1 ? 'guest' : 'guests'}</p>
                      </div>
                    </li>
                  );
                }
                return (
                  <li
                    key={dep.timeSlot}
                    className="flex items-center gap-4 rounded-2xl border border-[var(--color-ink)]/8 bg-white p-4 shadow-[var(--shadow-card)]"
                  >
                    <div className="min-w-0 flex-1">
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

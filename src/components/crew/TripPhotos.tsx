import type { RecentTrip } from '@/lib/trip-photos-server';
import { departureTimes, slotLabels, tours } from '@/lib/tours';
import { dayHeading } from './day-label';

function tripHeading(trip: RecentTrip): { time: string; tour: string } {
  const tour = tours.find((t) => t.id === trip.tourId);
  return {
    time: tour ? departureTimes(tour, trip.date).start : '',
    tour: `${slotLabels[trip.timeSlot]} · ${trip.type === 'private' ? 'Private' : 'Shared'}`,
  };
}

/**
 * Recent trips by day, each with its photo upload link: the same
 * no-sign-in page the 8 PM crew email links to. Photos go to the guests'
 * gallery (they're emailed automatically) and to Travis's Google Drive.
 */
export function TripPhotos({ trips, today }: { trips: RecentTrip[]; today: string }) {
  // Trips come newest first, so the days do too.
  const days = new Map<string, RecentTrip[]>();
  for (const trip of trips) days.set(trip.date, [...(days.get(trip.date) ?? []), trip]);

  return (
    <div className="space-y-5">
      {trips.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-[var(--color-ink)]/15 p-6 text-center text-sm text-[var(--color-ink-soft)]">
          No trips in the last week.
        </p>
      ) : (
        [...days.entries()].map(([date, list]) => {
          const day = dayHeading(date, today);
          return (
            <section key={date} aria-label={`${day.lead}, ${day.date}`}>
              <h2 className="mb-2 flex items-baseline gap-2">
                <span className="text-display text-lg">{day.lead}</span>
                <span className="text-sm text-[var(--color-ink-soft)]">{day.date}</span>
              </h2>
              <ul className="space-y-2">
                {list.map((trip) => {
                  const heading = tripHeading(trip);
                  return (
                    <li key={trip.id}>
                      <a
                        href={`/upload/${trip.uploadToken}`}
                        className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--color-sand)] bg-white p-4 active:bg-[var(--color-mist)]/60"
                      >
                        <span className="min-w-0">
                          <span className="block font-semibold">{heading.time || heading.tour}</span>
                          <span className="block text-sm text-[var(--color-ink-soft)]">
                            {heading.time && `${heading.tour} · `}
                            {trip.guests} {trip.guests === 1 ? 'guest' : 'guests'} ·{' '}
                            {trip.photoCount === 0
                              ? 'no photos yet'
                              : `${trip.photoCount} ${trip.photoCount === 1 ? 'photo' : 'photos'}`}
                          </span>
                        </span>
                        <span className="shrink-0 rounded-full bg-[var(--color-spring-deep)] px-4 py-2 text-sm font-semibold text-white">
                          Upload
                        </span>
                      </a>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })
      )}
    </div>
  );
}

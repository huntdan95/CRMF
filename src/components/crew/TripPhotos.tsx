import type { RecentTrip } from '@/lib/trip-photos-server';
import { slotLabels, tours } from '@/lib/tours';

function tripHeading(trip: RecentTrip): { day: string; time: string; tour: string } {
  const [y, m, d] = trip.date.split('-').map(Number);
  const day = new Date(Date.UTC(y!, m! - 1, d!)).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
  const tour = tours.find((t) => t.id === trip.tourId);
  return {
    day,
    time: tour?.startTimeDisplay ?? '',
    tour: `${slotLabels[trip.timeSlot]} · ${trip.type === 'private' ? 'Private' : 'Shared'}`,
  };
}

/**
 * Recent trips, each with its photo upload link: the same no-sign-in page
 * the 8 PM crew email links to. Photos go to the guests' gallery (they're
 * emailed automatically) and to Travis's Google Drive.
 */
export function TripPhotos({ trips }: { trips: RecentTrip[] }) {
  return (
    <section aria-labelledby="trip-photos" className="space-y-3">
      <div>
        <h2 id="trip-photos" className="text-display text-[1.375rem] leading-tight">
          Trip photos
        </h2>
        <p className="mt-1 text-sm text-[var(--color-ink-soft)]">
          Upload the GoPro shots from each trip. Guests get them by email
          automatically the next morning.
        </p>
      </div>
      {trips.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-[var(--color-ink)]/15 p-6 text-center text-sm text-[var(--color-ink-soft)]">
          No trips in the last week.
        </p>
      ) : (
        <ul className="space-y-2">
          {trips.map((trip) => {
            const heading = tripHeading(trip);
            return (
              <li key={trip.id}>
                <a
                  href={`/upload/${trip.uploadToken}`}
                  className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--color-sand)] bg-white p-4 active:bg-[var(--color-mist)]/60"
                >
                  <span className="min-w-0">
                    <span className="block font-semibold">
                      {heading.day}
                      {heading.time && `, ${heading.time}`}
                    </span>
                    <span className="block text-sm text-[var(--color-ink-soft)]">
                      {heading.tour} · {trip.guests} {trip.guests === 1 ? 'guest' : 'guests'} ·{' '}
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
      )}
    </section>
  );
}

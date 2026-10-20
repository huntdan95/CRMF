'use client';

import { useEffect, useState } from 'react';
import { listUpcomingTrips, type UpcomingTrip } from '@/lib/admin-firestore';
import { marinaNow } from '@/lib/availability';
import { clsx } from '@/lib/clsx';
import { departureMinutes, departureTime, partySize, shortDate, typeLabel } from './booking-labels';
import { Badge, PanelHeader, panelClass } from './ui';
import { TripCrewSwitch } from './TripCrewSwitch';

/** "Today · Tue, Oct 20", or just "Thu, Oct 22". */
function dayHeading(iso: string): string {
  const relative = shortDate(iso, { relative: true });
  const plain = shortDate(iso);
  return relative === plain ? plain : `${relative} · ${plain}`;
}

/** "4 guests", or "4+ guests" when old-site bookings on it have no party size on file. */
function tripGuests(t: UpcomingTrip): string {
  if (t.unknownPartyBookings === 0 || t.guests === 0) return partySize({ guestCount: t.guests });
  return `${t.guests}+ guests`;
}

/** A trip Travis closed, in the dashboard's words (AdminDashboardStats.tsx). */
const CLOSED_TEXT: Record<NonNullable<UpcomingTrip['off']>['kind'], string> = {
  cancelled: 'Not going out',
  closing: 'Closing: undo still open',
  'closed-booked': 'Closed, still booked: contact them',
};

/** Every upcoming trip with its crew switch, so Travis can run small ones alone. */
export function TripCrewAdmin() {
  const [trips, setTrips] = useState<UpcomingTrip[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listUpcomingTrips(marinaNow().date).then(
      (list) =>
        setTrips(
          list.sort((a, b) => a.date.localeCompare(b.date) || departureMinutes(a) - departureMinutes(b)),
        ),
      (err: unknown) => setError(err instanceof Error ? err.message : 'Failed to load.'),
    );
  }, []);

  const days = new Map<string, UpcomingTrip[]>();
  for (const t of trips ?? []) days.set(t.date, [...(days.get(t.date) ?? []), t]);

  return (
    <section className={clsx(panelClass, 'overflow-hidden')}>
      <PanelHeader
        title="Upcoming trips"
        description="Not enough guests to pay crew? Switch the crew off and run it yourself. The crew app shows it as “No crew needed” and their phones get a notification, and another if you switch them back on."
      />
      {error && (
        <p role="alert" className="p-5 text-sm text-[var(--color-coral-dark)]">
          {error}
        </p>
      )}
      {!trips && !error && (
        <p className="p-5 text-sm text-[var(--color-ink-soft)] animate-pulse">Loading trips…</p>
      )}
      {trips?.length === 0 && (
        <p className="p-5 text-sm text-[var(--color-ink-soft)]">No confirmed trips coming up.</p>
      )}
      {days.size > 0 && (
        <div className="divide-y divide-[var(--color-line)]">
          {[...days.entries()].map(([date, list]) => (
            <div key={date} className="px-5 py-4">
              <h3 className="text-sm font-semibold text-[var(--color-ink-soft)]">{dayHeading(date)}</h3>
              <ul className="mt-1 divide-y divide-[var(--color-line)]">
                {list.map((t) => (
                  <li key={t.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2">
                    <div className="min-w-0">
                      <p className="font-semibold">
                        {departureTime(t)} · {tripGuests(t)}
                      </p>
                      <p className="text-sm text-[var(--color-ink-soft)]">
                        {t.tourName} · {typeLabel(t.type)}
                        {t.bookings > 1 && ` · ${t.bookings} bookings`}
                      </p>
                      {t.off && (
                        <p className="mt-1">
                          <Badge tone="buoy">{CLOSED_TEXT[t.off.kind]}{t.off.reason === 'weather' ? ' (weather)' : ''}</Badge>
                        </p>
                      )}
                    </div>
                    {/* Not while it's being called off: as on the dashboard, the crew hear when that's final. */}
                    {t.off?.kind !== 'closing' && (
                      <TripCrewSwitch
                        date={t.date}
                        timeSlot={t.timeSlot}
                        time={departureTime(t)}
                        noCrew={t.noCrew}
                      />
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

import type { Metadata } from 'next';
import { requireCrew, fetchCrewSchedule, type CrewDeparture } from '@/lib/crew-server';
import { marinaNow } from '@/lib/availability';
import { Logo } from '@/components/marketing/Logo';
import { CrewSchedule } from '@/components/crew/CrewSchedule';
import { CrewNotifications } from '@/components/crew/CrewNotifications';
import { CrewCalendarLink } from '@/components/crew/CrewCalendarLink';
import { calendarLinkIssuedAt } from '@/lib/crew-calendar/server';
import { CrewSignOut } from '@/components/crew/CrewSignOut';
import { ScheduleFreshness } from '@/components/crew/ScheduleFreshness';
import { TripPhotos } from '@/components/crew/TripPhotos';
import { fetchRecentTrips, type RecentTrip } from '@/lib/trip-photos-server';
import { isDriveConfigured } from '@/lib/google-drive';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: { absolute: 'Manatee Crew' },
};

export default async function CrewPage() {
  const member = await requireCrew();
  const now = marinaNow();
  const today = now.date;

  const [departures, recentTrips, calendarSince] = await Promise.all([
    fetchCrewSchedule(today).catch((err): CrewDeparture[] | null => {
      console.error('Failed to load crew schedule:', err);
      return null;
    }),
    fetchRecentTrips(now).catch((err): RecentTrip[] | null => {
      console.error('Failed to load recent trips:', err);
      return null;
    }),
    calendarLinkIssuedAt(member.id).catch((err): Date | null => {
      console.error('Failed to check the calendar link:', err);
      return null;
    }),
  ]);

  const updatedAt = new Date().toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/New_York',
  });

  return (
    <div className="min-h-screen bg-[var(--color-paper)]">
      <header className="bg-[var(--color-spring-deep)] pt-[env(safe-area-inset-top)] text-white">
        <div className="mx-auto flex max-w-xl items-center justify-between gap-3 px-4 py-3">
          <Logo tone="light" />
          <CrewSignOut />
        </div>
      </header>

      <main className="mx-auto max-w-xl space-y-6 px-4 pt-6 pb-[calc(env(safe-area-inset-bottom)+2.5rem)]">
        <div>
          <p className="text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-[var(--color-spring)]">
            Crew
          </p>
          <h1 className="text-display text-[1.75rem] leading-tight">Upcoming tours</h1>
          <p className="mt-1 text-sm text-[var(--color-ink-soft)]">
            Hi {member.name.split(' ')[0]}. Paid, confirmed tours only, times are
            Crystal River time. Trips Travis called off stay listed, marked
            cancelled.
          </p>
          <div className="mt-1">
            <ScheduleFreshness updatedAt={updatedAt} />
          </div>
        </div>

        <CrewNotifications />

        {departures ? (
          <CrewSchedule departures={departures} today={today} />
        ) : (
          <div
            role="alert"
            className="rounded-2xl border border-[var(--color-error)]/30 bg-[var(--color-error)]/5 p-4 text-sm"
          >
            Couldn’t load the schedule just now. Tap Refresh in a minute.
          </div>
        )}

        {recentTrips && (
          <TripPhotos trips={recentTrips} uploadsEnabled={isDriveConfigured()} />
        )}

        <CrewCalendarLink
          linkSince={
            calendarSince
              ? calendarSince.toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                  timeZone: 'America/New_York',
                })
              : null
          }
        />
      </main>
    </div>
  );
}

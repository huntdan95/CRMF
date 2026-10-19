import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { requireCrew, fetchCrewSchedule, type CrewDeparture } from '@/lib/crew-server';
import { marinaNow } from '@/lib/availability';
import { Logo } from '@/components/marketing/Logo';
import { CrewSchedule } from '@/components/crew/CrewSchedule';
import { CrewNotifications } from '@/components/crew/CrewNotifications';
import { CrewSignOut } from '@/components/crew/CrewSignOut';
import { ScheduleFreshness } from '@/components/crew/ScheduleFreshness';
import { TripPhotos } from '@/components/crew/TripPhotos';
import { CrewTabs } from '@/components/crew/CrewTabs';
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

  const [departures, recentTrips] = await Promise.all([
    fetchCrewSchedule(today).catch((err): CrewDeparture[] | null => {
      console.error('Failed to load crew schedule:', err);
      return null;
    }),
    fetchRecentTrips(now).catch((err): RecentTrip[] | null => {
      console.error('Failed to load recent trips:', err);
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
          <ScheduleFreshness updatedAt={updatedAt} />
        </div>
      </header>

      <CrewTabs
        panels={{
          schedule: (
            <div className="space-y-4">
              <PanelHeading title="Upcoming tours">
                Hi {member.name.split(' ')[0]}. Paid, confirmed tours only, times
                are Crystal River time.
              </PanelHeading>
              {departures ? (
                <CrewSchedule departures={departures} today={today} />
              ) : (
                <LoadError>Couldn’t load the schedule just now. Tap the refresh button up top in a minute.</LoadError>
              )}
            </div>
          ),
          photos: (
            <div className="space-y-4">
              <PanelHeading title="Trip photos">
                Upload the GoPro shots from each trip. They go to the trip’s Google
                Drive folder and get emailed to the guests once you mark them all in.
              </PanelHeading>
              {recentTrips ? (
                <TripPhotos trips={recentTrips} today={today} uploadsEnabled={isDriveConfigured()} />
              ) : (
                <LoadError>Couldn’t load the recent trips just now. Tap the refresh button up top in a minute.</LoadError>
              )}
            </div>
          ),
          settings: (
            <div className="space-y-4">
              <PanelHeading title="Settings" />
              <CrewNotifications />
              <section className="rounded-2xl border border-[var(--color-ink)]/8 bg-white p-4 shadow-[var(--shadow-card)]">
                <h2 className="font-semibold">Signed in</h2>
                <p className="mt-0.5 text-sm text-[var(--color-ink-soft)]">
                  {member.name} · {member.email}
                </p>
                <div className="mt-3">
                  <CrewSignOut />
                </div>
              </section>
            </div>
          ),
        }}
      />
    </div>
  );
}

function PanelHeading({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div>
      <h1 className="text-display text-[1.75rem] leading-tight">{title}</h1>
      {children && <p className="mt-1 text-sm text-[var(--color-ink-soft)]">{children}</p>}
    </div>
  );
}

function LoadError({ children }: { children: ReactNode }) {
  return (
    <div
      role="alert"
      className="rounded-2xl border border-[var(--color-error)]/30 bg-[var(--color-error)]/5 p-4 text-sm"
    >
      {children}
    </div>
  );
}

import type { Metadata, Viewport } from 'next';
import { Logo } from '@/components/marketing/Logo';
import { TripUploader } from '@/components/trip-photos/TripUploader';
import { formatFriendlyDate } from '@/lib/date';
import { siteConfig } from '@/lib/site-config';
import { departureTimeOf, tripForUploadToken } from '@/lib/trip-photos-server';
import { ensureDriveConnectionDoc } from '@/lib/google-drive';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: { absolute: 'Upload trip photos' },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: '#0D3532',
  viewportFit: 'cover',
};

/**
 * /upload/<token>: the crew's photo upload for one departure. No login;
 * the link (in the 8 PM crew email, the crew app and the admin booking
 * page) is the key, and it stops taking uploads 7 days after the trip.
 */
export default async function UploadTripPhotosPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [trip] = await Promise.all([
    tripForUploadToken(token).catch((err) => {
      console.error('Upload link lookup failed:', err);
      return null;
    }),
    // So the functions copying these uploads find the Drive connection.
    ensureDriveConnectionDoc().catch((err) => console.error('Drive connection doc sync failed:', err)),
  ]);
  const open = !!trip?.open;
  const closedOn = trip
    ? new Date(trip.expiresAt - 1).toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        timeZone: 'America/New_York',
      })
    : null;

  return (
    <div className="min-h-screen bg-[var(--color-paper)]">
      <header className="bg-[var(--color-spring-deep)] pt-[env(safe-area-inset-top)] text-white">
        <div className="mx-auto flex max-w-xl items-center px-4 py-3">
          <Logo tone="light" />
        </div>
      </header>

      <main className="mx-auto max-w-xl space-y-5 px-4 pt-6 pb-[calc(env(safe-area-inset-bottom)+2.5rem)]">
        <div>
          <p className="text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-[var(--color-spring)]">
            Trip photos
          </p>
          {trip ? (
            <>
              <h1 className="text-display text-[1.75rem] leading-tight">
                {formatFriendlyDate(trip.date)}, {departureTimeOf(trip.timeSlot, trip.date)}
              </h1>
              <p className="mt-1 text-sm text-[var(--color-ink-soft)]">
                {trip.tourName ?? 'Tour'}
                {trip.unknownParty > 0
                  ? ` · ${trip.guests > 0 ? `${trip.guests}+ guests` : 'party size unknown'}`
                  : trip.guests > 0 && ` · ${trip.guests} ${trip.guests === 1 ? 'guest' : 'guests'}`}
              </p>
            </>
          ) : (
            <h1 className="text-display text-[1.75rem] leading-tight">This link doesn’t work</h1>
          )}
        </div>

        {!trip && (
          <p className="rounded-2xl border border-[var(--color-sand)] bg-white p-5">
            Check you have the whole link from the crew email, or ask Travis
            for a new one at{' '}
            <a href={siteConfig.contact.phoneHref} className="font-semibold underline underline-offset-4">
              {siteConfig.contact.phone}
            </a>
            .
          </p>
        )}

        {trip && !open && (
          <p className="rounded-2xl border border-[var(--color-sand)] bg-white p-5">
            This link stopped taking photos on {closedOn}, a week after the trip.
            Send any you still have to Travis.
          </p>
        )}

        {trip && open && (
          <>
            <p className="text-[0.9375rem]">
              Pick the photos and videos from this trip. They go to the guests’ gallery and Travis’s
              Google Drive. You don’t need to sign in.
            </p>
            <TripUploader tripId={trip.tripId} uploadToken={token} initialCount={trip.photoCount} />
          </>
        )}
      </main>
    </div>
  );
}

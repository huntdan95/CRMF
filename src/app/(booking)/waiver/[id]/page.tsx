import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { marinaNow } from '@/lib/availability';
import { siteConfig } from '@/lib/site-config';
import {
  bookingForWaiver,
  signableState,
  signedSummaries,
  tripWhen,
  waiverKey,
} from '@/lib/waiver/server';
import { WaiverSignFlow } from '@/components/waiver/WaiverSignFlow';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Sign your waiver',
  robots: { index: false, follow: false },
};

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ k?: string; t?: string }>;
}

const CLOSED = {
  cancelled: {
    title: 'This booking was cancelled',
    body: 'There’s nothing to sign. If you rebooked, use the waiver link from your new confirmation.',
  },
  unpaid: {
    title: 'This booking isn’t confirmed yet',
    body: 'Waivers open once payment goes through. Check back in a minute.',
  },
  past: {
    title: 'This trip has already happened',
    body: 'Waivers can only be signed before the tour.',
  },
} as const;

const UNAVAILABLE = {
  title: 'We couldn’t open your waiver just now',
  body: 'Something went wrong on our end, not with your link. Try it again in a minute.',
} as const;

/**
 * /waiver/{bookingId}?k={key} — where every adult on a booking signs the
 * liability waiver, and parents sign for their kids. The booker can also
 * arrive with ?t={accessToken} from their confirmation page; that's swapped
 * for the shareable key straight away so the link they copy and forward
 * can't be used to cancel the booking.
 */
export default async function WaiverPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const { k, t } = await searchParams;

  // bookingForWaiver is null for an unknown booking or a key that doesn't
  // match: a broken link. If it throws, Firestore had a bad moment and the
  // link is fine, so don't send them off to get it resent.
  const lookup = (cred: { key?: string; token?: string }) =>
    bookingForWaiver(id, cred).catch((err: unknown) => {
      console.error('Waiver page: booking lookup failed', err);
      return 'unavailable' as const;
    });

  if (t && !k) {
    const booking = await lookup({ token: t });
    if (booking === 'unavailable') return <Problem {...UNAVAILABLE} />;
    if (booking) redirect(`/waiver/${id}?k=${waiverKey(booking.accessToken)}`);
  }

  const booking = k ? await lookup({ key: k }) : null;
  if (booking === 'unavailable') return <Problem {...UNAVAILABLE} />;
  if (!booking || !k) {
    return (
      <Problem
        title="This waiver link doesn’t work"
        body="It may have been copied only partly. Open the link from your confirmation email again, or ask the person who booked to resend it."
      />
    );
  }

  const today = marinaNow().date;
  const state = signableState(booking, today);
  if (state !== 'open') return <Problem {...CLOSED[state]} />;

  const signed = await signedSummaries(booking.id);

  return (
    <div className="mx-auto max-w-2xl px-4 pb-20 pt-6 sm:px-6 sm:pt-10">
      <WaiverSignFlow
        bookingId={booking.id}
        waiverKey={k}
        tourName={booking.tourName}
        when={tripWhen(booking)}
        tripDate={booking.date}
        today={today}
        roster={booking.guests}
        guestCount={booking.guestCount}
        signed={signed}
      />
    </div>
  );
}

function Problem({ title, body }: { title: string; body: string }) {
  return (
    <div className="mx-auto max-w-xl px-4 pb-20 pt-10 sm:px-6">
      <div className="rounded-2xl border border-[var(--color-sand)] bg-white p-6">
        <h1 className="text-[20px] font-bold leading-tight">{title}</h1>
        <p className="mt-2 text-[var(--color-ink-soft)]">{body}</p>
        <p className="mt-4 text-sm">
          Questions? Call or text Travis at{' '}
          <a href={siteConfig.contact.phoneHref} className="font-medium underline underline-offset-2">
            {siteConfig.contact.phone}
          </a>
          .
        </p>
      </div>
    </div>
  );
}

import type { Metadata } from 'next';
import { adminDb } from '@/lib/firebase/admin';
import { formatFriendlyDate } from '@/lib/date';
import { siteConfig } from '@/lib/site-config';
import { FeedbackForm } from '@/components/booking/FeedbackForm';

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ t?: string }>;
}

export const metadata: Metadata = {
  title: 'Tell Travis privately',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

/** The booking this link is for, or null if the link doesn't match one. */
async function bookingFor(id: string, token: string | undefined) {
  if (!token || !/^[\w-]{1,64}$/.test(id)) return null;
  try {
    const snap = await adminDb().collection('bookings').doc(id).get();
    const b = snap.data() as
      | { accessToken?: string; customerName: string; tourName: string; date: string }
      | undefined;
    if (!b || b.accessToken !== token) return null;
    return { firstName: b.customerName.split(' ')[0] || b.customerName, tourName: b.tourName, date: b.date };
  } catch {
    return null;
  }
}

/**
 * "Something not right? Tell Travis privately", linked next to the Google
 * review link in the thank-you email. Goes straight to Travis; nothing
 * here is public.
 */
export default async function FeedbackPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const { t } = await searchParams;
  const booking = await bookingFor(id, t);

  return (
    <div className="mx-auto max-w-2xl px-5 pb-20 pt-10 sm:px-8 sm:pt-14">
      <header className="mb-8">
        <h1 className="text-display text-[2.4rem] sm:text-[3rem]">Tell Travis privately</h1>
        {booking ? (
          <p className="mt-3 text-lg text-[var(--color-ink-soft)]">
            Hi {booking.firstName}. If something about your {booking.tourName.toLowerCase()} on{' '}
            {formatFriendlyDate(booking.date)} wasn’t right, tell Travis here. It goes straight to
            him, not anywhere public, and he’ll get back to you.
          </p>
        ) : null}
      </header>

      {booking && t ? (
        <FeedbackForm bookingId={id} accessToken={t} />
      ) : (
        <div className="rounded-2xl border border-[var(--color-sand)] bg-white p-6">
          <p>
            This link doesn’t work. Call or text Travis at{' '}
            <a href={siteConfig.contact.phoneHref} className="font-semibold underline underline-offset-4">
              {siteConfig.contact.phone}
            </a>{' '}
            instead.
          </p>
        </div>
      )}
    </div>
  );
}

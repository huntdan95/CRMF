import type { Metadata } from 'next';
import Link from 'next/link';
import { downloadsOneAtATime, galleryForBooking } from '@/lib/trip-photos-server';
import { formatFriendlyDate } from '@/lib/date';
import { siteConfig } from '@/lib/site-config';
import { buttonClasses } from '@/components/ui/Button';
import { TripGallery } from '@/components/trip-photos/TripGallery';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Your trip photos',
  robots: { index: false, follow: false },
};

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ k?: string; t?: string }>;
}

/**
 * /my-booking/<id>/photos?k=<gallery key>: the photos and videos from the
 * guest's departure, as the photos email links it. Every party on a shared
 * tour sees the same gallery. The booking page links it with ?t= (the
 * booker's own token) instead, and only then is there a link back to it:
 * the email's link gets forwarded to the rest of the party.
 */
export default async function TripPhotosPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const { k, t } = await searchParams;
  const gallery =
    k || t
      ? await galleryForBooking(id, { key: k, token: t }).catch((err) => {
          console.error('Gallery lookup failed:', err);
          return null;
        })
      : null;

  if (!gallery) {
    return (
      <div className="mx-auto max-w-3xl px-5 pb-20 pt-10 sm:px-8 sm:pt-14">
        <h1 className="text-display text-[2.4rem] sm:text-[3rem]">Your trip photos</h1>
        <p className="mt-4 rounded-2xl border border-[var(--color-sand)] bg-white p-6">
          This link doesn’t open any photos. Use the link in your photos email, or call or text Travis at{' '}
          <a href={siteConfig.contact.phoneHref} className="font-semibold underline underline-offset-4">
            {siteConfig.contact.phone}
          </a>
          .
        </p>
      </div>
    );
  }

  const qs =
    'k' in gallery.opened ? `?k=${encodeURIComponent(gallery.opened.k)}` : `?t=${encodeURIComponent(gallery.opened.t)}`;
  const count = gallery.files.length;
  // Videos and big files aren't in the zip (photos/all): each downloads on its own.
  const separate = gallery.files.filter(downloadsOneAtATime);
  const zipped = count - separate.length;

  return (
    <div className="mx-auto max-w-5xl px-5 pb-20 pt-10 sm:px-8 sm:pt-14">
      <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-display text-[2.4rem] sm:text-[3rem]">Your trip photos</h1>
          <p className="mt-2 text-lg text-[var(--color-ink-soft)]">
            {gallery.tourName}, {formatFriendlyDate(gallery.date)}.
            {count > 0 && ` ${count} ${count === 1 ? 'photo or video' : 'photos and videos'}.`}
          </p>
          {separate.length > 0 && zipped > 0 && (
            <p className="mt-2 text-[var(--color-ink-soft)]">
              “Download all photos” saves the photos in one zip.{' '}
              {separate.every((f) => f.contentType.startsWith('video/')) ? 'Videos aren’t in it' : 'Videos and very large files aren’t in it'}:
              download each one with the button under it.
            </p>
          )}
        </div>
        {zipped > 0 && (
          <a href={`/my-booking/${id}/photos/all${qs}`} className={buttonClasses({ variant: 'primary', size: 'lg' })}>
            {separate.length > 0 ? 'Download all photos' : 'Download all'}
          </a>
        )}
      </header>

      {count === 0 ? (
        <p className="rounded-2xl border border-[var(--color-sand)] bg-white p-6">
          No photos from your trip yet. You’ll get an email when they’re here.
        </p>
      ) : (
        <TripGallery bookingId={id} query={qs} files={gallery.files} />
      )}

      <p className="mt-10 text-sm text-[var(--color-ink-soft)]">
        Posting any? Tag us on{' '}
        <a href={siteConfig.captain.instagram} className="underline underline-offset-4" target="_blank" rel="noopener noreferrer">
          Instagram
        </a>
        . We love sharing guest shots.
        {'t' in gallery.opened && (
          <>
            {' '}
            <Link href={`/my-booking/${id}${qs}`} className="underline underline-offset-4">
              Back to your booking
            </Link>
          </>
        )}
      </p>
    </div>
  );
}

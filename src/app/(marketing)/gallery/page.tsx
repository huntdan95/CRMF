import type { Metadata } from 'next';
import Image from 'next/image';
import { Section, SectionTitle } from '@/components/marketing/Section';
import { Button } from '@/components/ui/Button';
import { adminDb } from '@/lib/firebase/admin';
import { siteConfig } from '@/lib/site-config';
import { getSlotConfig } from '@/lib/site-images';
import type { SiteImage } from '@/lib/firebase/types';

export const revalidate = 60;

export const metadata: Metadata = {
  title: 'Photo Gallery — Manatees, Springs & Guests on the Water',
  description:
    'Photos from real Crystal River Manatee Fun tours: manatees in the springs, guests snorkeling, the boat, the marina, and the morning light.',
  alternates: { canonical: `${siteConfig.url}/gallery` },
};

async function fetchAllUploadedPhotos(): Promise<SiteImage[]> {
  try {
    const snap = await adminDb().collection('siteImages').get();
    return snap.docs
      .map((d) => d.data() as SiteImage)
      .filter((d) => d?.downloadUrl);
  } catch {
    return [];
  }
}

export default async function GalleryPage() {
  const photos = await fetchAllUploadedPhotos();

  return (
    <>
      <Section tone="cream" size="md">
        <SectionTitle
          eyebrow="Gallery"
          title="From the river, this season."
          description="Real photos from real tours — no stock manatees. Travis or guests took every shot."
        />
      </Section>

      <Section tone="white" size="md">
        {photos.length === 0 ? (
          <div className="max-w-md mx-auto text-center rounded-2xl bg-[var(--color-cream)] border border-[var(--color-ink)]/8 p-8">
            <p className="font-display text-xl">No photos uploaded yet.</p>
            <p className="mt-2 text-sm text-[var(--color-ink-soft)]">
              Travis hasn&rsquo;t loaded the gallery yet — check back soon, or
              follow along on{' '}
              <a
                href={siteConfig.captain.instagram}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[var(--color-brand-blue)] hover:underline"
              >
                Instagram
              </a>
              .
            </p>
          </div>
        ) : (
          <div className="columns-1 sm:columns-2 lg:columns-3 gap-4 [column-fill:_balance]">
            {photos.map((p) => {
              // Best-effort alt text using slot config when nothing was set
              // explicitly at upload time.
              let alt = p.alt;
              if (!alt) {
                try {
                  alt = getSlotConfig(p.slot).defaultAlt;
                } catch {
                  alt = 'Crystal River manatee tour';
                }
              }
              const aspect =
                p.width && p.height ? `${p.width} / ${p.height}` : '4 / 3';
              return (
                <figure
                  key={p.slot}
                  className="mb-4 break-inside-avoid rounded-2xl overflow-hidden border border-[var(--color-ink)]/8 shadow-[var(--shadow-card)] bg-[var(--color-cream)]"
                >
                  <div className="relative w-full" style={{ aspectRatio: aspect }}>
                    <Image
                      src={p.downloadUrl}
                      alt={alt}
                      fill
                      sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                      className="object-cover"
                    />
                  </div>
                </figure>
              );
            })}
          </div>
        )}
      </Section>

      <Section tone="cream" size="md">
        <div className="text-center max-w-xl mx-auto">
          <h2 className="font-display text-3xl sm:text-4xl leading-tight">
            Want to be the next photo?
          </h2>
          <p className="mt-4 text-[var(--color-ink-soft)]">
            Book a tour and tag us on Instagram — we&rsquo;ll often share
            guest photos to the gallery (with your permission).
          </p>
          <div className="mt-6">
            <Button href="/book" size="lg">
              Book a tour
            </Button>
          </div>
        </div>
      </Section>
    </>
  );
}

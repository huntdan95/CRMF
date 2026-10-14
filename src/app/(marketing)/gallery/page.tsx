import type { Metadata } from 'next';
import { Button } from '@/components/ui/Button';
import { Container, Section, SectionTitle } from '@/components/marketing/Section';
import { GalleryGrid, type GalleryPhoto } from '@/components/marketing/GalleryGrid';
import { ArrowRight, Instagram } from '@/components/ui/icons';
import { adminDb, adminStorage } from '@/lib/firebase/admin';
import { photos as localPhotos, sceneryPhotoKeys } from '@/lib/photos';
import { siteConfig } from '@/lib/site-config';
import { pageSeo } from '@/lib/seo';
import { getSlotConfig } from '@/lib/site-images';
import type { SiteImage } from '@/lib/firebase/types';

export const revalidate = 60;

const title = 'Photo Gallery — Manatees, Springs & Guests on the Water';
const description =
  'Photos from real Crystal River Manatee Fun tours: manatees in the springs, guests snorkeling, the boat, the marina, and the morning light.';

export const metadata: Metadata = {
  title,
  description,
  ...pageSeo('/gallery', { title, description }),
};

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([p, new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms))]);
}

/**
 * Every admin-uploaded site photo, minus exact duplicates (the same file is
 * often uploaded to several slots, e.g. a legacy slot and its replacement).
 * Duplicates are spotted by the stored file's MD5.
 */
async function fetchUploadedPhotos(): Promise<GalleryPhoto[]> {
  try {
    const snap = await withTimeout(adminDb().collection('siteImages').get(), 3000, null);
    if (!snap) return [];
    const docs = snap.docs.map((d) => d.data() as SiteImage).filter((d) => d?.downloadUrl);

    // If Storage metadata can't be read for any reason, skip the de-dupe
    // rather than lose the photos.
    const md5 = async (d: SiteImage): Promise<string> => {
      try {
        const [m] = await adminStorage().bucket().file(d.storagePath).getMetadata();
        return (m.md5Hash as string | undefined) ?? d.downloadUrl;
      } catch {
        return d.downloadUrl;
      }
    };
    const hashes = await Promise.all(docs.map((d) => withTimeout(md5(d), 2500, d.downloadUrl)));

    const seen = new Set<string>();
    const out: GalleryPhoto[] = [];
    docs.forEach((d, i) => {
      if (seen.has(hashes[i]!)) return;
      seen.add(hashes[i]!);
      let alt = d.alt;
      if (!alt) {
        try {
          alt = getSlotConfig(d.slot).defaultAlt;
        } catch {
          alt = 'Crystal River manatee tour';
        }
      }
      out.push({ src: d.downloadUrl, alt, width: d.width ?? 4, height: d.height ?? 3 });
    });
    return out;
  } catch {
    return [];
  }
}

export default async function GalleryPage() {
  const uploaded = await fetchUploadedPhotos();
  const bundled: GalleryPhoto[] = sceneryPhotoKeys.map((k) => localPhotos[k]).map((p) => ({
    src: p.src,
    alt: p.alt,
    width: p.src.width,
    height: p.src.height,
  }));
  const all = [...uploaded, ...bundled];

  return (
    <>
      <Section tone="paper" size="md" className="!pb-10">
        <SectionTitle
          as="h1"
          size="lg"
          title="From the river"
          description="Real photos from real tours, no stock manatees. Travis or his guests took every one."
        />
      </Section>

      <Section tone="paper" size="sm" className="!pt-0 pb-20 sm:pb-28">
        <GalleryGrid photos={all} />
      </Section>

      <section className="bg-[var(--color-spring-deep)] text-white">
        <Container className="flex flex-col gap-8 py-16 sm:py-20 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-display text-[2.1rem] sm:text-5xl">Be in the next one.</h2>
            <p className="mt-3 max-w-xl text-lg text-white/75">
              Every tour comes with free GoPro photos. Tag{' '}
              <a
                href={siteConfig.captain.instagram}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-white underline underline-offset-2"
              >
                @capt.travisurbin
              </a>{' '}
              and yours might end up here.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button href="/book" size="lg">
              Book a tour
              <ArrowRight size={18} />
            </Button>
            <Button href={siteConfig.captain.instagram} size="lg" variant="glass" target="_blank" rel="noopener noreferrer">
              <Instagram size={18} />
              Instagram
            </Button>
          </div>
        </Container>
      </section>
    </>
  );
}

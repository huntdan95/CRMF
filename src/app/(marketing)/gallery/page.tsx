import type { Metadata } from 'next';
import { PlaceholderImage } from '@/components/marketing/PlaceholderImage';
import { Section, SectionTitle } from '@/components/marketing/Section';
import { Button } from '@/components/ui/Button';
import { siteConfig } from '@/lib/site-config';

export const metadata: Metadata = {
  title: 'Photo Gallery — Manatees, Springs & Guests on the Water',
  description:
    'Photos from real Crystal River Manatee Fun tours: manatees in the springs, guests snorkeling, the boat, the marina, and the morning light.',
  alternates: { canonical: `${siteConfig.url}/gallery` },
};

// Phase 2 uses placeholder slots so the owner can see how many photos the
// layout expects. Real images get dropped into /public/images/gallery/ and
// the array is replaced with `<Image>` components.
const photos = [
  { label: 'Mother manatee with calf', aspect: 'portrait' as const, tone: 'bg-[var(--color-brand-blue)]/15' },
  { label: 'Snorkelers in Three Sisters Springs', aspect: 'square' as const, tone: 'bg-[var(--color-coral)]/15' },
  { label: 'Manatee swimming under boat', aspect: 'video' as const, tone: 'bg-[var(--color-brand-blue)]/15' },
  { label: 'Boat at sunrise at Pete\'s Pier', aspect: 'square' as const, tone: 'bg-[var(--color-manatee)]/20' },
  { label: 'Family on the bow', aspect: 'portrait' as const, tone: 'bg-[var(--color-coral)]/15' },
  { label: 'Manatee face close-up', aspect: 'square' as const, tone: 'bg-[var(--color-brand-blue)]/15' },
  { label: 'Spring-water clarity shot', aspect: 'video' as const, tone: 'bg-[var(--color-manatee)]/20' },
  { label: 'Travis pointing out a manatee', aspect: 'portrait' as const, tone: 'bg-[var(--color-coral)]/15' },
  { label: 'Kid in mask, smiling', aspect: 'square' as const, tone: 'bg-[var(--color-brand-blue)]/15' },
  { label: 'Three Sisters from the boardwalk', aspect: 'video' as const, tone: 'bg-[var(--color-manatee)]/20' },
  { label: 'Two manatees nuzzling', aspect: 'square' as const, tone: 'bg-[var(--color-coral)]/15' },
  { label: 'Wide shot of Kings Bay', aspect: 'wide' as const, tone: 'bg-[var(--color-brand-blue)]/15' },
];

export default function GalleryPage() {
  return (
    <>
      <Section tone="cream" size="md">
        <SectionTitle
          eyebrow="Gallery"
          title="From the river, this season."
          description="No stock photos. Every shot is from a real tour, taken either by Travis or by guests who sent them over after their trip."
        />
        <p className="mt-2 text-xs text-center text-[var(--color-ink-soft)] opacity-70">
          [TODO: Replace placeholder slots with photos from the old WordPress
          media library / new shoots. Then convert to next/image.]
        </p>
      </Section>

      <Section tone="white" size="md">
        <div className="columns-1 sm:columns-2 lg:columns-3 gap-4 [column-fill:_balance]">
          {photos.map((p, i) => (
            <div key={i} className="mb-4 break-inside-avoid">
              <PlaceholderImage
                label={p.label}
                aspect={p.aspect}
                tone={p.tone}
              />
            </div>
          ))}
        </div>
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

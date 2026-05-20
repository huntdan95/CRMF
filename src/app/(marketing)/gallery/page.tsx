import type { Metadata } from 'next';
import { SiteImage } from '@/components/marketing/SiteImage';
import { Section, SectionTitle } from '@/components/marketing/Section';
import { Button } from '@/components/ui/Button';
import { siteConfig } from '@/lib/site-config';
import type { SiteImageSlot } from '@/lib/firebase/types';

export const revalidate = 60;

export const metadata: Metadata = {
  title: 'Photo Gallery — Manatees, Springs & Guests on the Water',
  description:
    'Photos from real Crystal River Manatee Fun tours: manatees in the springs, guests snorkeling, the boat, the marina, and the morning light.',
  alternates: { canonical: `${siteConfig.url}/gallery` },
};

/**
 * Order the five photo slots for a balanced masonry rhythm — wide shots
 * interleave with portrait shots. Each `SiteImage` falls back to a styled
 * placeholder when its slot isn't uploaded yet.
 */
const items: { slot: SiteImageSlot; aspect: 'square' | 'portrait' | 'video' | 'wide' }[] = [
  { slot: 'hero', aspect: 'video' },
  { slot: 'pair', aspect: 'square' },
  { slot: 'greeting', aspect: 'portrait' },
  { slot: 'group', aspect: 'wide' },
  { slot: 'dappled', aspect: 'square' },
  { slot: 'hero', aspect: 'portrait' },
  { slot: 'group', aspect: 'square' },
  { slot: 'pair', aspect: 'video' },
  { slot: 'dappled', aspect: 'portrait' },
  { slot: 'greeting', aspect: 'square' },
];

export default function GalleryPage() {
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
        <div className="columns-1 sm:columns-2 lg:columns-3 gap-4 [column-fill:_balance]">
          {items.map((p, i) => (
            <div key={i} className="mb-4 break-inside-avoid">
              <SiteImage slot={p.slot} aspect={p.aspect} />
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

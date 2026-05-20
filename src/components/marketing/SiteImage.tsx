import 'server-only';
import Image from 'next/image';
import { adminDb } from '@/lib/firebase/admin';
import { clsx } from '@/lib/clsx';
import { getSlotConfig } from '@/lib/site-images';
import type { SiteImage as SiteImageDoc, SiteImageSlot } from '@/lib/firebase/types';

interface Props {
  slot: SiteImageSlot;
  /** Override alt text if you want something more specific than the default. */
  alt?: string;
  aspect?: 'square' | 'video' | 'portrait' | 'wide' | 'auto';
  rounded?: 'lg' | '2xl' | 'full' | 'none';
  /** Override the placeholder tone when no image is uploaded. */
  tone?: string;
  className?: string;
  /** Render as eagerly-loaded above-the-fold image. */
  priority?: boolean;
  /** Used by next/image to pick the right size variant. */
  sizes?: string;
  /** Hint to the placeholder fallback caption. */
  placeholderLabel?: string;
}

const aspectClass: Record<NonNullable<Props['aspect']>, string> = {
  square: 'aspect-square',
  video: 'aspect-video',
  portrait: 'aspect-[3/4]',
  wide: 'aspect-[21/9]',
  auto: '',
};

const roundedClass: Record<NonNullable<Props['rounded']>, string> = {
  lg: 'rounded-lg',
  '2xl': 'rounded-2xl',
  full: 'rounded-full',
  none: '',
};

async function fetchSiteImage(slot: SiteImageSlot): Promise<SiteImageDoc | null> {
  try {
    const snap = await adminDb().collection('siteImages').doc(slot).get();
    if (!snap.exists) return null;
    return snap.data() as SiteImageDoc;
  } catch {
    // Firestore unreachable or admin SDK unavailable in this environment —
    // fall through to the placeholder.
    return null;
  }
}

/**
 * Renders an admin-controlled site photo if one has been uploaded for the
 * given slot, otherwise a styled placeholder. Server component.
 */
export async function SiteImage({
  slot,
  alt,
  aspect = 'video',
  rounded = '2xl',
  tone,
  className = '',
  priority = false,
  sizes = '(min-width: 1024px) 50vw, 100vw',
  placeholderLabel,
}: Props) {
  const doc = await fetchSiteImage(slot);
  const config = getSlotConfig(slot);
  const containerClass = clsx(
    'relative w-full overflow-hidden',
    aspectClass[aspect],
    roundedClass[rounded],
    className,
  );

  if (doc) {
    return (
      <div className={containerClass}>
        <Image
          src={doc.downloadUrl}
          alt={alt || doc.alt || config.defaultAlt}
          fill
          priority={priority}
          sizes={sizes}
          className="object-cover"
        />
      </div>
    );
  }

  // Placeholder fallback (no upload yet).
  return (
    <div
      role="img"
      aria-label={alt || config.defaultAlt}
      className={clsx(
        containerClass,
        'border border-[var(--color-brand-blue)]/10 flex items-center justify-center',
        tone ?? config.placeholderTone,
      )}
    >
      <div className="absolute inset-0 opacity-30 bg-[radial-gradient(circle_at_30%_20%,var(--color-cream),transparent_60%)]" />
      <div className="relative z-10 text-center px-6 py-3 max-w-[80%]">
        <p className="text-xs uppercase tracking-widest text-[var(--color-brand-blue-dark)] font-medium opacity-70">
          Photo
        </p>
        <p className="font-display text-base sm:text-lg text-[var(--color-ink)] mt-1 leading-snug">
          {placeholderLabel ?? config.label}
        </p>
        <p className="mt-2 text-xs text-[var(--color-ink-soft)]">
          Upload at /admin/photos
        </p>
      </div>
    </div>
  );
}

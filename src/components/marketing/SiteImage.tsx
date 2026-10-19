import 'server-only';
import { cache } from 'react';
import Image, { type StaticImageData } from 'next/image';
import { adminDb, adminStorage } from '@/lib/firebase/admin';
import { clsx } from '@/lib/clsx';
import { siteConfig } from '@/lib/site-config';
import { getSlotConfig } from '@/lib/site-images';
import { photos, sceneryPhotoKeys } from '@/lib/photos';
import type { SiteImage as SiteImageDoc, SiteImageSlot } from '@/lib/firebase/types';

interface Props {
  slot: SiteImageSlot;
  /**
   * If the primary slot has no upload, try this slot before falling back
   * to the bundled photo. Keeps pre-refactor uploads (pair, greeting,
   * dappled, group) visible after the slot system was reorganized.
   */
  fallbackSlot?: SiteImageSlot;
  /** Override alt text if you want something more specific than the default. */
  alt?: string;
  aspect?: 'square' | 'video' | 'portrait' | 'wide' | 'auto';
  rounded?: 'lg' | 'xl' | '2xl' | 'full' | 'none';
  className?: string;
  /** Classes for the <img> itself (e.g. hover zoom, object position). */
  imgClassName?: string;
  /** Render as eagerly-loaded above-the-fold image. */
  priority?: boolean;
  /** Used by next/image to pick the right size variant. */
  sizes?: string;
}

const aspectClass: Record<NonNullable<Props['aspect']>, string> = {
  square: 'aspect-square',
  video: 'aspect-video',
  portrait: 'aspect-[4/5]',
  wide: 'aspect-[21/9]',
  auto: '',
};

const roundedClass: Record<NonNullable<Props['rounded']>, string> = {
  lg: 'rounded-lg',
  xl: 'rounded-xl',
  '2xl': 'rounded-2xl',
  full: 'rounded-full',
  none: '',
};

const LOOKUP_TIMEOUT_MS = 2500;

// Cached per request: a page can ask for the same slot more than once
// (the photo itself, and its URL for structured data).
const fetchSiteImage = cache(async (slot: SiteImageSlot): Promise<SiteImageDoc | null> => {
  try {
    const read = adminDb().collection('siteImages').doc(slot).get();
    const snap = await Promise.race([
      read,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), LOOKUP_TIMEOUT_MS)),
    ]);
    if (!snap || !snap.exists) return null;
    return snap.data() as SiteImageDoc;
  } catch {
    // Firestore unreachable or admin SDK unavailable in this environment —
    // fall through to the bundled photo.
    return null;
  }
});

// Tailwind doesn't deduplicate utility classes — if the caller passes
// `absolute inset-0` and we also add `relative`, the order in the
// generated CSS decides which wins (alphabetical: `relative` beats
// `absolute`), which collapses the container to zero height. Detect
// any caller-supplied position class and skip the default `relative`.
const POSITION_CLASSES = ['absolute', 'fixed', 'sticky', 'relative'];
function hasCallerPosition(className: string): boolean {
  if (!className) return false;
  return className.split(/\s+/).some((c) => POSITION_CLASSES.includes(c));
}

/**
 * Renders the admin-uploaded photo for a slot (uploaded at /admin/photos),
 * or the slot's bundled fallback photo when nothing has been uploaded.
 * Server component.
 */
export async function SiteImage({
  slot,
  fallbackSlot,
  alt,
  aspect = 'video',
  rounded = 'none',
  className = '',
  imgClassName,
  priority = false,
  sizes = '(min-width: 1024px) 50vw, 100vw',
}: Props) {
  // Try primary slot, then fallback. Run both lookups in parallel so the
  // miss doesn't double our RTT.
  const [primary, fallback] = await Promise.all([
    fetchSiteImage(slot),
    fallbackSlot ? fetchSiteImage(fallbackSlot) : Promise.resolve(null),
  ]);
  const doc = primary ?? fallback;
  const config = getSlotConfig(slot);
  const containerClass = clsx(
    !hasCallerPosition(className) && 'relative',
    'w-full overflow-hidden bg-[var(--color-spring-deep)]',
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
          className={clsx('object-cover', imgClassName)}
        />
      </div>
    );
  }

  const local = photos[config.fallbackPhoto];
  return (
    <div className={containerClass}>
      <Image
        src={local.src}
        alt={alt || local.alt}
        fill
        priority={priority}
        sizes={sizes}
        placeholder="blur"
        className={clsx('object-cover', imgClassName)}
      />
    </div>
  );
}

/**
 * Absolute URL of the photo a slot shows, the same one {@link SiteImage}
 * picks, for structured data and other places that need a plain URL.
 */
export async function siteImageUrl(slot: SiteImageSlot, fallbackSlot?: SiteImageSlot): Promise<string> {
  const [primary, fallback] = await Promise.all([
    fetchSiteImage(slot),
    fallbackSlot ? fetchSiteImage(fallbackSlot) : Promise.resolve(null),
  ]);
  const doc = primary ?? fallback;
  if (doc) return doc.downloadUrl;
  return `${siteConfig.url}${photos[getSlotConfig(slot).fallbackPhoto].src.src}`;
}

// ---------------------------------------------------------------------------
// Groups of photos that must not repeat (e.g. three tour cards in a row)
// ---------------------------------------------------------------------------

export interface ResolvedPhoto {
  src: string | StaticImageData;
  alt: string;
  /** Bundled photo (gets a blur placeholder). */
  local: boolean;
}

/**
 * Identity of an uploaded file. The same picture uploaded to two slots
 * gets two URLs, so compare the stored file's MD5 when Storage allows it.
 */
async function fileIdentity(doc: SiteImageDoc): Promise<string> {
  const read = (async () => {
    try {
      const [meta] = await adminStorage().bucket().file(doc.storagePath).getMetadata();
      return (meta.md5Hash as string | undefined) ?? doc.downloadUrl;
    } catch {
      return doc.downloadUrl;
    }
  })();
  return Promise.race([
    read,
    new Promise<string>((resolve) => setTimeout(() => resolve(doc.downloadUrl), LOOKUP_TIMEOUT_MS)),
  ]);
}

/**
 * Resolves a set of slots to photos that are all different from each other:
 * each slot's upload, then its fallback slot's, then a bundled photo nobody
 * else in the set is using.
 */
export async function resolveDistinctPhotos(
  specs: Array<{ slot: SiteImageSlot; fallbackSlot?: SiteImageSlot }>,
): Promise<ResolvedPhoto[]> {
  const docs = await Promise.all(
    specs.map((s) =>
      Promise.all([fetchSiteImage(s.slot), s.fallbackSlot ? fetchSiteImage(s.fallbackSlot) : null]),
    ),
  );
  const ids = await Promise.all(
    docs.map((pair) => Promise.all(pair.map((d) => (d ? fileIdentity(d) : null)))),
  );

  const usedFiles = new Set<string>();
  const usedLocal = new Set<string>();
  return specs.map((spec, i) => {
    const config = getSlotConfig(spec.slot);
    for (let j = 0; j < 2; j++) {
      const doc = docs[i]![j];
      const id = ids[i]![j];
      if (doc && id && !usedFiles.has(id)) {
        usedFiles.add(id);
        return { src: doc.downloadUrl, alt: doc.alt || config.defaultAlt, local: false };
      }
    }
    const order = [config.fallbackPhoto, ...sceneryPhotoKeys];
    const key = order.find((k) => !usedLocal.has(k)) ?? config.fallbackPhoto;
    usedLocal.add(key);
    return { src: photos[key].src, alt: photos[key].alt, local: true };
  });
}

/** Renders a photo from resolveDistinctPhotos(). */
export function ResolvedImage({
  photo,
  className,
  imgClassName,
  sizes = '(min-width: 1024px) 50vw, 100vw',
  priority = false,
}: {
  photo: ResolvedPhoto;
  className?: string;
  imgClassName?: string;
  sizes?: string;
  priority?: boolean;
}) {
  return (
    <div className={clsx('relative w-full overflow-hidden bg-[var(--color-spring-deep)]', className)}>
      <Image
        src={photo.src}
        alt={photo.alt}
        fill
        priority={priority}
        sizes={sizes}
        placeholder={photo.local ? 'blur' : 'empty'}
        className={clsx('object-cover', imgClassName)}
      />
    </div>
  );
}

/**
 * Shared metadata for every photo slot used across the site.
 *
 * Admin uploads at /admin/photos write to `siteImages/{slot}` in Firestore.
 * The `<SiteImage>` RSC component reads those docs and renders next/image,
 * with an optional fallback slot for graceful degradation, falling back to
 * a styled placeholder when neither slot has an upload.
 */
import type { SiteImageSlot } from './firebase/types';
import type { photos } from './photos';

export type LocalPhotoKey = keyof typeof photos;

export interface SlotConfig {
  slot: SiteImageSlot;
  /** Customer-facing label shown in the admin UI. */
  label: string;
  /** Short copy describing where this photo shows up on the site. */
  description: string;
  /** Fallback alt text when no upload exists. */
  defaultAlt: string;
  /** Background tone for the placeholder when no image is uploaded. */
  placeholderTone: string;
  /** Which UI group to show this slot in on /admin/photos. */
  group: 'sections' | 'tours' | 'legacy';
  /** Bundled photo shown until something is uploaded (see src/lib/photos.ts). */
  fallbackPhoto: LocalPhotoKey;
}

export const SITE_IMAGE_SLOTS: SlotConfig[] = [
  // ---------------------------------------------------------------------
  // Site sections
  // ---------------------------------------------------------------------
  {
    slot: 'hero',
    label: 'Home page — top photo',
    description:
      'The big photo across the top of the home page. Use your most eye-catching shot, like a snorkeler with a manatee.',
    defaultAlt: 'Snorkeling with a wild manatee in Crystal River, Florida',
    placeholderTone: 'bg-[var(--color-spring-deep)]',
    fallbackPhoto: 'motherAndCalf',
    group: 'sections',
  },
  {
    slot: 'manners-callout',
    label: 'Home page — “The water is theirs”',
    description:
      'Next to the part of the home page about respecting the manatees. A mother and calf, or two manatees together, works best.',
    defaultAlt: 'A manatee in a Crystal River spring',
    placeholderTone: 'bg-[var(--color-mist)]',
    fallbackPhoto: 'motherAndCalf',
    group: 'sections',
  },
  {
    slot: 'about-captain',
    label: 'Captain photo',
    description:
      'Next to your bio on the home page and the About page. A tall photo (phone held upright) of you on the boat works best.',
    defaultAlt: 'Capt. Travis Urbin on his boat',
    placeholderTone: 'bg-[var(--color-sand)]',
    fallbackPhoto: 'captain',
    group: 'sections',
  },
  {
    slot: 'about-area',
    label: 'About page — Crystal River area',
    description:
      'In the part of the About page about the area. A group of manatees or a wide shot of a spring works well.',
    defaultAlt: 'Manatees in a Crystal River spring',
    placeholderTone: 'bg-[var(--color-sand)]',
    fallbackPhoto: 'snorkelGroup',
    group: 'sections',
  },

  // ---------------------------------------------------------------------
  // Per-tour cards (9 — one per active tour). Each shows on:
  //   • The /tours grid card for that tour
  //   • The home page featured-tours grid (when that tour is featured)
  //   • The /tours/[slug] page hero
  // ---------------------------------------------------------------------
  {
    slot: 'tour-morning-shared',
    label: 'Tour — Morning, Shared',
    description: 'The 8:00 AM shared tour. Shows on its card and at the top of its page.',
    defaultAlt: 'A manatee in the morning light',
    placeholderTone: 'bg-[var(--color-mist)]',
    fallbackPhoto: 'grazing',
    group: 'tours',
  },
  {
    slot: 'tour-morning-private',
    label: 'Tour — Morning, Private',
    description: 'The 8:00 AM private tour. Shows on its card and at the top of its page.',
    defaultAlt: 'A private morning manatee tour',
    placeholderTone: 'bg-[var(--color-sand)]',
    fallbackPhoto: 'guestsAboard',
    group: 'tours',
  },
  {
    slot: 'tour-mid-morning-shared',
    label: 'Tour — Mid-morning, Shared',
    description: 'The 10:30 AM shared tour. Shows on its card and at the top of its page.',
    defaultAlt: 'A manatee in clear mid-morning water',
    placeholderTone: 'bg-[var(--color-mist)]',
    fallbackPhoto: 'snorkelGroup',
    group: 'tours',
  },
  {
    slot: 'tour-mid-morning-private',
    label: 'Tour — Mid-morning, Private',
    description: 'The 10:30 AM private tour. Shows on its card and at the top of its page.',
    defaultAlt: 'Private mid-morning manatee tour',
    placeholderTone: 'bg-[var(--color-sand)]',
    fallbackPhoto: 'guestsAboard',
    group: 'tours',
  },
  {
    slot: 'tour-early-afternoon-shared',
    label: 'Tour — Early Afternoon, Shared',
    description: 'The 1:00 PM shared tour. Shows on its card and at the top of its page.',
    defaultAlt: 'An afternoon manatee tour in bright water',
    placeholderTone: 'bg-[var(--color-mist)]',
    fallbackPhoto: 'grazing',
    group: 'tours',
  },
  {
    slot: 'tour-early-afternoon-private',
    label: 'Tour — Early Afternoon, Private',
    description: 'The 1:00 PM private tour. Shows on its card and at the top of its page.',
    defaultAlt: 'Private afternoon manatee tour',
    placeholderTone: 'bg-[var(--color-sand)]',
    fallbackPhoto: 'guestsAboard',
    group: 'tours',
  },
  {
    slot: 'tour-late-afternoon-shared',
    label: 'Tour — Late Afternoon, Shared',
    description: 'The 3:30 PM shared tour. Shows on its card and at the top of its page.',
    defaultAlt: 'A manatee in late afternoon light',
    placeholderTone: 'bg-[var(--color-mist)]',
    fallbackPhoto: 'manateeSurfacing',
    group: 'tours',
  },
  {
    slot: 'tour-late-afternoon-private',
    label: 'Tour — Late Afternoon, Private',
    description: 'The 3:30 PM private tour. Shows on its card and at the top of its page.',
    defaultAlt: 'Private late afternoon manatee tour',
    placeholderTone: 'bg-[var(--color-sand)]',
    fallbackPhoto: 'guestsAboard',
    group: 'tours',
  },
  {
    slot: 'tour-whole-day-private',
    label: 'Tour — Whole Day, Private',
    description: 'The whole-day private charter. Shows on its card and at the top of its page.',
    defaultAlt: 'A whole day on the Crystal River',
    placeholderTone: 'bg-[var(--color-mist)]',
    fallbackPhoto: 'manateeSurfacing',
    group: 'tours',
  },

  // ---------------------------------------------------------------------
  // Legacy slots (kept so pre-refactor uploads keep working as fallbacks).
  // ---------------------------------------------------------------------
  {
    slot: 'pair',
    label: 'Older photo — Manatee pair',
    description:
      'Fills in on the home page while “Home page — The water is theirs” is empty. Upload there instead.',
    defaultAlt: 'A manatee in a Crystal River spring',
    placeholderTone: 'bg-[var(--color-mist)]',
    fallbackPhoto: 'motherAndCalf',
    group: 'legacy',
  },
  {
    slot: 'greeting',
    label: 'Older photo — Manatee greeting',
    description:
      'Fills in while “Captain photo” is empty. Upload there instead.',
    defaultAlt: 'Capt. Travis Urbin on his boat',
    placeholderTone: 'bg-[var(--color-sand)]',
    fallbackPhoto: 'captain',
    group: 'legacy',
  },
  {
    slot: 'dappled',
    label: 'Older photo — Dappled light',
    description:
      'Fills in on any tour without its own photo. Upload to each tour above instead, so every tour gets its own.',
    defaultAlt: 'A manatee in a Crystal River spring',
    placeholderTone: 'bg-[var(--color-mist)]',
    fallbackPhoto: 'grazing',
    group: 'legacy',
  },
  {
    slot: 'group',
    label: 'Older photo — Group of manatees',
    description:
      'Fills in while “About page — Crystal River area” is empty. Upload there instead.',
    defaultAlt: 'Manatees in a Crystal River spring',
    placeholderTone: 'bg-[var(--color-sand)]',
    fallbackPhoto: 'snorkelGroup',
    group: 'legacy',
  },
];

export function getSlotConfig(slot: SiteImageSlot): SlotConfig {
  const found = SITE_IMAGE_SLOTS.find((s) => s.slot === slot);
  if (!found) throw new Error(`Unknown site image slot: ${slot}`);
  return found;
}

/** All tour slots, ordered to match the tour catalog. */
export const TOUR_SLOTS: readonly SiteImageSlot[] = [
  'tour-morning-shared',
  'tour-morning-private',
  'tour-mid-morning-shared',
  'tour-mid-morning-private',
  'tour-early-afternoon-shared',
  'tour-early-afternoon-private',
  'tour-late-afternoon-shared',
  'tour-late-afternoon-private',
  'tour-whole-day-private',
];

/** Look up a per-tour slot by the tour's slug. */
export function tourSlotForSlug(slug: string): SiteImageSlot | null {
  const candidate = `tour-${slug}` as SiteImageSlot;
  return TOUR_SLOTS.includes(candidate) ? candidate : null;
}

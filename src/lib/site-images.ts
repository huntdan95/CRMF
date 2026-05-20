/**
 * Shared metadata for every photo slot used across the site.
 *
 * Admin uploads at /admin/photos write to `siteImages/{slot}` in Firestore.
 * The `<SiteImage>` RSC component reads those docs and renders next/image,
 * with an optional fallback slot for graceful degradation, falling back to
 * a styled placeholder when neither slot has an upload.
 */
import type { SiteImageSlot } from './firebase/types';

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
}

export const SITE_IMAGE_SLOTS: SlotConfig[] = [
  // ---------------------------------------------------------------------
  // Site sections
  // ---------------------------------------------------------------------
  {
    slot: 'hero',
    label: 'Homepage hero',
    description:
      "The big background photo on the home page hero. Whatever's most eye-catching — a wide spring shot, a snorkeler with a manatee, etc.",
    defaultAlt: 'Snorkeling with a wild manatee in Crystal River, Florida',
    placeholderTone: 'bg-[var(--color-brand-blue)]',
    group: 'sections',
  },
  {
    slot: 'manners-callout',
    label: 'Manners callout (home)',
    description:
      'The split-screen "The water is theirs" section on the home page. A mother-and-calf or two-manatee shot works best here — emotional anchor for the protection message.',
    defaultAlt: 'A mother manatee and calf swimming together',
    placeholderTone: 'bg-[var(--color-brand-blue)]/15',
    group: 'sections',
  },
  {
    slot: 'about-captain',
    label: 'About page — Captain section',
    description:
      'Portrait-orientation photo next to the "Meet your captain" bio. Travis at the helm, or a close-up manatee greeting shot until a real headshot is available.',
    defaultAlt: 'A curious manatee approaching a snorkeler underwater',
    placeholderTone: 'bg-[var(--color-coral)]/15',
    group: 'sections',
  },
  {
    slot: 'about-area',
    label: 'About page — Crystal River area',
    description:
      'Square-ish photo in the area-guide section of the About page. A group-of-manatees shot or wide spring shot works.',
    defaultAlt: 'Several manatees gathered in a Crystal River spring',
    placeholderTone: 'bg-[var(--color-cream-dark)]',
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
    description: 'Hero photo for the 8:00 AM shared tour card and detail page.',
    defaultAlt: 'A manatee in the morning light',
    placeholderTone: 'bg-[var(--color-brand-blue)]/12',
    group: 'tours',
  },
  {
    slot: 'tour-morning-private',
    label: 'Tour — Morning, Private',
    description: 'Hero photo for the 8:00 AM private (whole boat) tour.',
    defaultAlt: 'A private morning manatee tour',
    placeholderTone: 'bg-[var(--color-coral)]/12',
    group: 'tours',
  },
  {
    slot: 'tour-mid-morning-shared',
    label: 'Tour — Mid-morning, Shared',
    description: 'Hero photo for the 10:30 AM shared tour.',
    defaultAlt: 'A manatee in clear mid-morning water',
    placeholderTone: 'bg-[var(--color-brand-blue)]/12',
    group: 'tours',
  },
  {
    slot: 'tour-mid-morning-private',
    label: 'Tour — Mid-morning, Private',
    description: 'Hero photo for the 10:30 AM private tour.',
    defaultAlt: 'Private mid-morning manatee tour',
    placeholderTone: 'bg-[var(--color-coral)]/12',
    group: 'tours',
  },
  {
    slot: 'tour-early-afternoon-shared',
    label: 'Tour — Early Afternoon, Shared',
    description: 'Hero photo for the 1:00 PM shared tour.',
    defaultAlt: 'An afternoon manatee tour in bright water',
    placeholderTone: 'bg-[var(--color-brand-blue)]/12',
    group: 'tours',
  },
  {
    slot: 'tour-early-afternoon-private',
    label: 'Tour — Early Afternoon, Private',
    description: 'Hero photo for the 1:00 PM private tour.',
    defaultAlt: 'Private afternoon manatee tour',
    placeholderTone: 'bg-[var(--color-coral)]/12',
    group: 'tours',
  },
  {
    slot: 'tour-late-afternoon-shared',
    label: 'Tour — Late Afternoon, Shared',
    description: 'Hero photo for the 3:30 PM shared tour.',
    defaultAlt: 'A manatee in late afternoon light',
    placeholderTone: 'bg-[var(--color-brand-blue)]/12',
    group: 'tours',
  },
  {
    slot: 'tour-late-afternoon-private',
    label: 'Tour — Late Afternoon, Private',
    description: 'Hero photo for the 3:30 PM private tour.',
    defaultAlt: 'Private late afternoon manatee tour',
    placeholderTone: 'bg-[var(--color-coral)]/12',
    group: 'tours',
  },
  {
    slot: 'tour-whole-day-private',
    label: 'Tour — Whole Day, Private',
    description: 'Hero photo for the all-day private charter card.',
    defaultAlt: 'A whole day on the Crystal River',
    placeholderTone: 'bg-[var(--color-manatee)]/20',
    group: 'tours',
  },

  // ---------------------------------------------------------------------
  // Legacy slots (kept so pre-refactor uploads keep working as fallbacks).
  // ---------------------------------------------------------------------
  {
    slot: 'pair',
    label: 'Legacy — Manatee pair',
    description:
      'Old fallback for the manners callout. New uploads should go to "Manners callout (home)" above.',
    defaultAlt: 'A mother manatee and calf',
    placeholderTone: 'bg-[var(--color-brand-blue)]/10',
    group: 'legacy',
  },
  {
    slot: 'greeting',
    label: 'Legacy — Manatee greeting',
    description:
      'Old fallback for the about-captain section. New uploads should go to "About page — Captain section" above.',
    defaultAlt: 'A curious manatee greeting a snorkeler',
    placeholderTone: 'bg-[var(--color-coral)]/10',
    group: 'legacy',
  },
  {
    slot: 'dappled',
    label: 'Legacy — Dappled light',
    description:
      'Old fallback for every tour card. New uploads should go to the individual tour slots above so each card gets its own photo.',
    defaultAlt: 'Sunlight dappling a manatee',
    placeholderTone: 'bg-[var(--color-manatee)]/15',
    group: 'legacy',
  },
  {
    slot: 'group',
    label: 'Legacy — Group of manatees',
    description:
      'Old fallback for the About page area section. New uploads should go to "About page — Crystal River area" above.',
    defaultAlt: 'Several manatees gathered',
    placeholderTone: 'bg-[var(--color-cream-dark)]',
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

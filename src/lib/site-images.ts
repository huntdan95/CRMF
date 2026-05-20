/**
 * Shared metadata for the five photo slots used across the site.
 *
 * Admin uploads at /admin/photos write to `siteImages/{slot}` in Firestore.
 * The `<SiteImage>` RSC component reads those docs and falls back to the
 * placeholder text + colour when a slot hasn't been uploaded yet.
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
}

export const SITE_IMAGE_SLOTS: SlotConfig[] = [
  {
    slot: 'hero',
    label: 'Hero',
    description:
      'Homepage hero background and the tours-page hero. A wide, eye-catching shot — usually a single manatee head-on or a snorkeler-with-manatee scene.',
    defaultAlt: 'Snorkeling with a wild manatee in Crystal River, Florida',
    placeholderTone: 'bg-[var(--color-brand-blue)]',
  },
  {
    slot: 'pair',
    label: 'Manners callout',
    description:
      'The "manatee manners" section on the home page and the About page transition. A mother-and-calf or two-manatee shot works best here.',
    defaultAlt: 'A mother manatee and calf swimming together',
    placeholderTone: 'bg-[var(--color-brand-blue)]/15',
  },
  {
    slot: 'greeting',
    label: 'Captain section',
    description:
      'About page captain section — a curious manatee close-up that conveys connection.',
    defaultAlt: 'A curious manatee approaching a snorkeler underwater',
    placeholderTone: 'bg-[var(--color-coral)]/15',
  },
  {
    slot: 'dappled',
    label: 'Tour cards / tour pages',
    description:
      'Background for tour cards on the home and /tours grid, plus the hero on each /tours/[slug] page. A light-dappled manatee photo works beautifully.',
    defaultAlt: 'Sunlight dappling across the back of a swimming manatee',
    placeholderTone: 'bg-[var(--color-manatee)]/20',
  },
  {
    slot: 'group',
    label: 'About — Crystal River area',
    description:
      'About page area-guide section. A group-of-manatees shot or wide spring shot works.',
    defaultAlt: 'Several manatees gathered in a Crystal River spring',
    placeholderTone: 'bg-[var(--color-cream-dark)]',
  },
];

export function getSlotConfig(slot: SiteImageSlot): SlotConfig {
  const found = SITE_IMAGE_SLOTS.find((s) => s.slot === slot);
  if (!found) throw new Error(`Unknown site image slot: ${slot}`);
  return found;
}

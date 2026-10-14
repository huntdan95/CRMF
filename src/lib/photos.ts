/**
 * Photos that ship with the site (from the old WordPress posts). They're
 * the fallback whenever an admin photo slot is empty, and they're used
 * directly where a section needs a specific kind of shot (people on the
 * boat, a group in the water).
 *
 * Static imports give next/image the real dimensions and a blur
 * placeholder for free.
 */
import type { StaticImageData } from 'next/image';
import guestsAboard from '../../public/images/news/guests-aboard-pontoon-boat-crystal-river.jpg';
import manateeSurfacing from '../../public/images/news/manatee-surfacing-kings-bay.jpg';
import motherAndCalf from '../../public/images/news/mother-manatee-and-calf.jpg';
import snorkelGroup from '../../public/images/news/snorkel-group-with-manatees-kings-bay.jpg';
import grazing from '../../public/images/news/snorkelers-watch-manatee-graze-seagrass.jpg';

export interface LocalPhoto {
  src: StaticImageData;
  alt: string;
}

export const photos = {
  guestsAboard: {
    src: guestsAboard,
    alt: 'Three guests in wetsuits giving a shaka on the pontoon boat on Kings Bay',
  },
  manateeSurfacing: {
    src: manateeSurfacing,
    alt: 'A manatee surfacing to breathe in calm water',
  },
  motherAndCalf: {
    src: motherAndCalf,
    alt: 'A mother manatee and her calf swimming over the spring bottom, with a snorkeler at the surface',
  },
  snorkelGroup: {
    src: snorkelGroup,
    alt: 'A group of snorkelers floating on orange noodles above a manatee in Kings Bay',
  },
  grazing: {
    src: grazing,
    alt: 'Snorkelers watching a manatee graze on seagrass right below them',
  },
} satisfies Record<string, LocalPhoto>;

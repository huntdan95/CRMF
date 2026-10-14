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
import captain from '../../public/images/captain-travis-urbin.jpg';
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
  captain: {
    src: captain,
    alt: 'Capt. Travis Urbin holding a hogfish on his boat',
  },
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

/** Photos that can stand in for any slot (not the captain's portrait). */
export const sceneryPhotoKeys = (Object.keys(photos) as Array<keyof typeof photos>).filter(
  (k) => k !== 'captain',
);

/*
 * Defaults for the `settings/site` fields Travis edits in Admin → Settings
 * and the automated emails read. They apply until he saves his own.
 * Client-safe (the booking form uses the sizes). MUST stay in sync with
 * functions/src/lib/site-settings.ts.
 */

export interface WetsuitSizes {
  adult: string[];
  kids: string[];
}

export const DEFAULT_GOOGLE_REVIEW_URL = 'https://g.page/r/CfMjq7APsSV4EBM/review';

export const DEFAULT_WETSUIT_SIZES: WetsuitSizes = {
  adult: ['S', 'M', 'L', 'XL', '2XL', '3XL', '4XL'],
  kids: ['2', '4', '6', '8', '10', '12', '14', '16'],
};

function nonEmptyList(v: unknown): string[] | null {
  return Array.isArray(v) && v.length > 0 && v.every((s) => typeof s === 'string')
    ? (v as string[])
    : null;
}

/** The stocked sizes from a `settings/site` doc, or the defaults. */
export function wetsuitSizesFrom(settings: { wetsuitSizes?: Partial<WetsuitSizes> } | null | undefined): WetsuitSizes {
  return {
    adult: nonEmptyList(settings?.wetsuitSizes?.adult) ?? DEFAULT_WETSUIT_SIZES.adult,
    kids: nonEmptyList(settings?.wetsuitSizes?.kids) ?? DEFAULT_WETSUIT_SIZES.kids,
  };
}

/**
 * What a guest's `wetsuitSize` holds: an adult size as listed ("XL"), or a
 * kids' size with "Kids " in front ("Kids 8"), so the two groups never
 * collide and a crew tally reads without a legend.
 */
export function kidsSizeValue(size: string): string {
  return `Kids ${size}`;
}

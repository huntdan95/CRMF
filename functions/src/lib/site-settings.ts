import { db } from './firebase';

/*
 * The parts of `settings/site` the automated messages read. Travis edits
 * them in Admin → Settings (adminUpdateSettings), so they're read on every
 * run rather than baked in: a change takes effect without a deploy.
 *
 * Defaults are the owner's answers (2026-10-14) and apply until Travis
 * saves his own. MUST stay in sync with src/lib/site-settings.ts.
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

export interface AutomationSettings {
  googleReviewUrl: string;
  wetsuitSizes: WetsuitSizes;
}

function nonEmptyList(v: unknown): string[] | null {
  return Array.isArray(v) && v.length > 0 && v.every((s) => typeof s === 'string')
    ? (v as string[])
    : null;
}

export async function getAutomationSettings(): Promise<AutomationSettings> {
  const data = (await db.doc('settings/site').get()).data() ?? {};
  const sizes = (data.wetsuitSizes ?? {}) as Partial<WetsuitSizes>;
  return {
    googleReviewUrl:
      typeof data.googleReviewUrl === 'string' && data.googleReviewUrl
        ? data.googleReviewUrl
        : DEFAULT_GOOGLE_REVIEW_URL,
    wetsuitSizes: {
      adult: nonEmptyList(sizes.adult) ?? DEFAULT_WETSUIT_SIZES.adult,
      kids: nonEmptyList(sizes.kids) ?? DEFAULT_WETSUIT_SIZES.kids,
    },
  };
}

/**
 * What a guest's `wetsuitSize` holds: an adult size as listed ("XL"), or a
 * kids' size with "Kids " in front ("Kids 8"), so the two groups never
 * collide and a crew tally reads without a legend.
 */
export function wetsuitSizeValues(sizes: WetsuitSizes): string[] {
  return [...sizes.adult, ...sizes.kids.map((k) => `Kids ${k}`)];
}

/**
 * "2 × M, 1 × XL, 1 × Kids 8": sizes in stocked order, then anything no
 * longer stocked, then guests without one.
 */
export function wetsuitTally(
  guests: Array<{ wetsuitSize?: string | null }>,
  sizes: WetsuitSizes,
): string {
  const counts = new Map<string, number>();
  let missing = 0;
  for (const g of guests) {
    if (g.wetsuitSize) counts.set(g.wetsuitSize, (counts.get(g.wetsuitSize) ?? 0) + 1);
    else missing++;
  }
  const order = wetsuitSizeValues(sizes);
  const keys = [...counts.keys()].sort((a, b) => {
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    return (ia === -1 ? order.length : ia) - (ib === -1 ? order.length : ib) || a.localeCompare(b);
  });
  const parts = keys.map((k) => `${counts.get(k)} × ${k}`);
  if (missing > 0) parts.push(`${missing} not given`);
  return parts.join(', ');
}

/**
 * Pure helpers shared by the signing page, the signing API and admin:
 * ages, initials, and which guests on a booking a signed waiver covers.
 */

/** Whole years between a `YYYY-MM-DD` birth date and a `YYYY-MM-DD` day. */
export function ageOn(dob: string, day: string): number {
  const [by, bm, bd] = dob.split('-').map(Number) as [number, number, number];
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  let age = y - by;
  if (m < bm || (m === bm && d < bd)) age -= 1;
  return age;
}

/** Florida's age of majority. */
export const ADULT_AGE = 18;

/** "Mary-Jane O'Neil" → "MO"; "Ana de la Cruz" → "AC". */
export function initialsOf(name: string): string {
  const words = name
    .normalize('NFKD')
    .replace(/[^\p{L}\s'-]/gu, '')
    .split(/[\s-]+/)
    .filter(Boolean);
  if (words.length === 0) return '';
  const first = words[0]!;
  const last = words.length > 1 ? words[words.length - 1]! : '';
  return (first[0]! + (last[0] ?? '')).toUpperCase();
}

/**
 * Comparison key for names: case, accents, punctuation and spacing ignored.
 * Letters from any script count ("王伟", "Иван"), so two different
 * non-Latin names don't both reduce to an empty key and match each other.
 */
export function nameKey(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export interface CoveredPerson {
  name: string;
  /** The booking-roster name they picked when signing, if any. */
  rosterName: string | null;
  minor: boolean;
  waiverId: string;
  signerName: string;
}

/** The fields of a signed waiver that coverage needs. */
export interface WaiverForCoverage {
  id: string;
  signer: { name: string; participating: boolean; rosterName: string | null };
  minors: Array<{ name: string; rosterName: string | null }>;
}

export interface Coverage {
  /** Booking roster, in order, each with the person covering them (or null). */
  roster: Array<{ name: string; age: number | null; covered: CoveredPerson | null }>;
  /** Signed people who didn't match a roster name (a nickname, a swap). */
  unmatched: CoveredPerson[];
  /**
   * People on the boat with a signed waiver: covered roster guests, plus
   * unmatched signers only up to the number of unnamed guests.
   */
  signedCount: number;
  /** People the booking is for. */
  needed: number;
}

/**
 * Who on a booking has a signed waiver. A roster guest is covered when a
 * signed person picked them from the roster or signed under the same name.
 * Signers who aren't going on the tour (a parent signing for a child) don't
 * count toward the boat.
 */
export function waiverCoverage(
  guests: Array<{ name: string; age: number | null }>,
  guestCount: number,
  waivers: WaiverForCoverage[],
): Coverage {
  const signed: CoveredPerson[] = [];
  for (const w of waivers) {
    if (w.signer.participating) {
      signed.push({
        name: w.signer.name,
        rosterName: w.signer.rosterName,
        minor: false,
        waiverId: w.id,
        signerName: w.signer.name,
      });
    }
    for (const m of w.minors) {
      signed.push({
        name: m.name,
        rosterName: m.rosterName,
        minor: true,
        waiverId: w.id,
        signerName: w.signer.name,
      });
    }
  }

  // One entry per person. An adult who signed twice (say, after a network
  // error), or a child both parents listed, is still one person on the
  // boat; counting them twice would show "All signed" while someone else
  // in the party hasn't. A name is only a repeat beyond the number of
  // people on the roster who share it (John Smith and his son John Smith),
  // and adults and children are never mistaken for each other. Callers pass
  // waivers oldest first, so the earliest signatures are the ones kept.
  const rosterCount = new Map<string, number>();
  for (const g of guests) {
    const k = nameKey(g.name);
    if (k) rosterCount.set(k, (rosterCount.get(k) ?? 0) + 1);
  }
  const seen = new Map<string, number>();
  const people = signed.filter((p) => {
    const name = nameKey(p.rosterName ?? p.name);
    if (!name) return true;
    const key = `${p.minor ? 'minor' : 'adult'}|${name}`;
    const count = seen.get(key) ?? 0;
    if (count >= Math.max(1, rosterCount.get(name) ?? 0)) return false;
    seen.set(key, count + 1);
    return true;
  });

  const used = new Set<CoveredPerson>();
  const take = (match: (p: CoveredPerson) => boolean) => {
    const found = people.find((p) => !used.has(p) && match(p));
    if (found) used.add(found);
    return found ?? null;
  };

  // Roster picks first, then exact name matches, so a later signer with
  // the same name can't steal a slot someone explicitly picked.
  const covered: Array<CoveredPerson | null> = guests.map((g) =>
    take((p) => p.rosterName != null && nameKey(p.rosterName) === nameKey(g.name)),
  );
  guests.forEach((g, i) => {
    if (!covered[i]) covered[i] = take((p) => nameKey(p.name) === nameKey(g.name));
  });

  const unmatched = people.filter((p) => !used.has(p));
  const needed = Math.max(guestCount, guests.length);
  // Someone who signed under a name that isn't on the roster only counts
  // toward guests the booking never named. Counting them against a named
  // guest would show "all signed" while that guest hasn't: a nickname or a
  // swapped guest has to be sorted out by Travis, not assumed.
  const unnamedSlots = needed - guests.length;
  return {
    roster: guests.map((g, i) => ({ name: g.name, age: g.age, covered: covered[i] ?? null })),
    unmatched,
    signedCount: covered.filter(Boolean).length + Math.min(unmatched.length, unnamedSlots),
    needed,
  };
}

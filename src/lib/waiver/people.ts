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

/*
 * Scripts the signed PDF's fonts cover (src/lib/waiver/fonts.ts), plus
 * the shared punctuation, digits and accents. Emoji are "Common" too, but
 * the fonts have none.
 */
const PRINTABLE_SCRIPTS =
  /^[\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Common}\p{Script=Inherited}]*$/u;

/**
 * The signing page's quick guess that the signed PDF can't print some of
 * `text` (Korean, Arabic, Thai, emoji, …), so it asks for the name in
 * English letters before the guest signs. The server checks against the
 * font files themselves and has the final say: it asks for any it finds
 * that this misses.
 */
export function mayNotPrint(text: string): boolean {
  return !PRINTABLE_SCRIPTS.test(text) || /\p{Extended_Pictographic}/u.test(text);
}

/**
 * A name in Latin letters, as on a passport ("Kim Minjun", "Zoë O'Neil"):
 * what the PDF prints for a name it can't. Two letters or more; spaces,
 * hyphens, apostrophes and periods allowed.
 */
export function isLatinName(name: string): boolean {
  const n = name.trim();
  return /^[\p{Script=Latin}\p{M} .'’-]+$/u.test(n) && (n.match(/\p{Script=Latin}/gu)?.length ?? 0) >= 2;
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
  /**
   * Named guests on the booking roster, in order, each with the person
   * covering them (or null). A roster entry with a blank name ("leave blank
   * if you don't know them yet") is one of the unnamed guests instead.
   */
  roster: Array<{ name: string; age: number | null; covered: CoveredPerson | null }>;
  /** Signed people who didn't match a roster name (a nickname, a swap). */
  unmatched: CoveredPerson[];
  /**
   * People on the boat with a signed waiver: covered roster guests, plus
   * unmatched signers only up to the number of unnamed guests (all of them
   * when the party size isn't on file).
   */
  signedCount: number;
  /**
   * People the booking is for. 0 when the party size isn't on file: an
   * old-site booking with no guest count and no names.
   */
  needed: number;
  /**
   * Everyone the booking is for has signed. Never true when the party size
   * isn't on file: however many have signed, there's no telling who's left.
   */
  complete: boolean;
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
  // A guest with a blank name can't be matched to anyone who signs, so
  // they'd show as "not signed" for good (and as an empty name to tap on
  // the signing page). They're unnamed guests, like those beyond the roster.
  const named = guests.filter((g) => nameKey(g.name));
  const rosterCount = new Map<string, number>();
  for (const g of named) {
    const k = nameKey(g.name);
    rosterCount.set(k, (rosterCount.get(k) ?? 0) + 1);
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
  const covered: Array<CoveredPerson | null> = named.map((g) =>
    take((p) => p.rosterName != null && nameKey(p.rosterName) === nameKey(g.name)),
  );
  named.forEach((g, i) => {
    if (!covered[i]) covered[i] = take((p) => nameKey(p.name) === nameKey(g.name));
  });

  const unmatched = people.filter((p) => !used.has(p));
  const needed = Math.max(guestCount, guests.length);
  // Someone who signed under a name that isn't on the roster only counts
  // toward guests the booking never named. Counting them against a named
  // guest would show "all signed" while that guest hasn't: a nickname or a
  // swapped guest has to be sorted out by Travis, not assumed. With no
  // party size on file, every signer counts, but that's never "everyone".
  const unnamedSlots = needed === 0 ? unmatched.length : needed - named.length;
  const signedCount = covered.filter(Boolean).length + Math.min(unmatched.length, unnamedSlots);
  return {
    roster: named.map((g, i) => ({ name: g.name, age: g.age, covered: covered[i] ?? null })),
    unmatched,
    signedCount,
    needed,
    complete: needed > 0 && signedCount >= needed,
  };
}

import path from 'node:path';
import { Font } from '@react-pdf/renderer';
import { isLatinName } from './people';

/*
 * The signed PDF's fonts: registered for react-pdf here, and checked here
 * for what they can print. Server only (it reads the font files); the
 * signing page makes a quick guess with mayNotPrint in ./people instead.
 *
 * The PDF's built-in Helvetica and Courier only cover Western European
 * letters, and names, addresses, initials and emails can be in any script.
 * Noto Sans covers Latin (Polish, Vietnamese, …), Greek and Cyrillic; where
 * it has no glyph, react-pdf falls back to Noto Sans SC for Chinese and
 * Japanese kana (regular weight only: bold CJK prints regular). Not
 * covered: Korean, Arabic, Hebrew, Indic, Thai, emoji. A name in one of
 * those is also asked for in Latin letters, and the PDF prints that
 * (namesForPdf below).
 *
 * Read from disk at render time, so they must ship with the server:
 * App Hosting copies public/ into the standalone build, and process.cwd()
 * is that build's root. SIL OFL, see public/fonts/OFL.txt.
 */
const FONT_DIR = path.join(process.cwd(), 'public', 'fonts');
Font.register({
  family: 'Noto Sans',
  fonts: [
    { src: path.join(FONT_DIR, 'NotoSans-Regular.ttf') },
    { src: path.join(FONT_DIR, 'NotoSans-Bold.ttf'), fontWeight: 'bold' },
  ],
});
Font.register({ family: 'Noto Sans SC', src: path.join(FONT_DIR, 'NotoSansSC-Regular.ttf') });
export const SANS = ['Noto Sans', 'Noto Sans SC'];

/** Guests' text prints in regular weight, and initials in bold. */
const WEIGHTS = [400, 700] as const;

interface GlyphLookup {
  hasGlyphForCodePoint(codePoint: number): boolean;
}

let stacks: Promise<GlyphLookup[][]> | null = null;

/**
 * For each weight, the fonts react-pdf picks from, in order. These are the
 * renderer's own loaded fonts (react-pdf keeps each one once loaded), so
 * the check reads the same files the PDF is drawn with, once per server.
 */
function fontStacks(): Promise<GlyphLookup[][]> {
  if (stacks) return stacks;
  const loading = Promise.all(
    WEIGHTS.map((fontWeight) =>
      Promise.all(
        SANS.map(async (fontFamily) => {
          await Font.load({ fontFamily, fontWeight });
          // A fontkit font. (react-pdf types it through @types/fontkit,
          // which isn't installed.)
          const font = Font.getFont({ fontFamily, fontWeight }).data as GlyphLookup | null;
          if (!font) throw new Error(`Font didn't load: ${fontFamily} ${fontWeight}`);
          return font;
        }),
      ),
    ),
  );
  // A failed read (a font file missing from the build) is tried again next time.
  stacks = loading.catch((err) => {
    stacks = null;
    throw err;
  });
  return stacks;
}

/**
 * The characters in `text` that no font in the signed PDF can draw, each
 * once, in order. Empty when it all prints. For these react-pdf falls back
 * to the PDF's built-in Helvetica, which prints other characters in their
 * place ("김" comes out as "®@"): wrong letters, not a blank.
 */
export async function unprintableChars(text: string): Promise<string[]> {
  const fonts = await fontStacks();
  const missing = new Set<string>();
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (!fonts.every((stack) => stack.some((f) => f.hasGlyphForCodePoint(cp)))) missing.add(ch);
  }
  return [...missing];
}

/** “김민준…”: the first few of unprintableChars, for a message. */
export function quoteChars(chars: string[]): string {
  return `“${chars.slice(0, 3).join('')}${chars.length > 3 ? '…' : ''}”`;
}

/** A name as the signed record keeps it. */
export interface RecordName {
  /** Exactly as typed. */
  name: string;
  /** What the PDF prints instead, when it can't print `name`; else null. */
  latinName: string | null;
}

export type NamesForPdf =
  | { ok: true; signer: RecordName; minors: RecordName[] }
  | {
      ok: false;
      error: string;
      field: string;
      /** The names still needing a Latin-letters version (none: fix `field`). */
      latinNamesNeeded: Array<{ field: string; name: string }>;
    };

/**
 * The signer's and minors' names for the record and the PDF. A name the
 * PDF can't print needs the same name in Latin letters, which the PDF
 * prints in its place; the record keeps both. A Latin version sent for a
 * name that prints as typed is dropped, so `latinName` on a record always
 * means the PDF printed it.
 */
export async function namesForPdf(input: {
  signer: { name: string; latinName?: string | null };
  minors: Array<{ name: string; latinName?: string | null }>;
}): Promise<NamesForPdf> {
  const people = [
    { field: 'signer.latinName', whose: 'your', ...input.signer },
    ...input.minors.map((m, i) => ({ field: `minors.${i}.latinName`, whose: `${m.name.trim()}’s`, ...m })),
  ];
  const needed: Array<{ field: string; name: string }> = [];
  const resolved: RecordName[] = [];
  for (const p of people) {
    const name = p.name.trim();
    if ((await unprintableChars(name)).length === 0) {
      resolved.push({ name, latinName: null });
      continue;
    }
    const latinName = p.latinName?.trim().replace(/\s+/g, ' ') ?? '';
    if (!latinName) {
      needed.push({ field: p.field, name });
      continue;
    }
    if (!isLatinName(latinName)) {
      return {
        ok: false,
        field: p.field,
        error: `Type ${p.whose} name in English letters (A to Z), as on a passport.`,
        latinNamesNeeded: [],
      };
    }
    const bad = await unprintableChars(latinName);
    if (bad.length > 0) {
      return {
        ok: false,
        field: p.field,
        error: `The signed PDF can’t print ${quoteChars(bad)}. Use plain English letters, as on a passport.`,
        latinNamesNeeded: [],
      };
    }
    resolved.push({ name, latinName });
  }

  if (needed.length > 0) {
    return {
      ok: false,
      field: needed[0]!.field,
      error:
        needed.length === 1
          ? `The signed PDF can’t print some of the letters in ${needed[0]!.name}. Add the name in English letters, as on a passport.`
          : `The signed PDF can’t print some of the letters in ${needed.map((n) => n.name).join(', ')}. Add each name in English letters, as on a passport.`,
      latinNamesNeeded: needed,
    };
  }
  const [signer, ...minors] = resolved;
  return { ok: true, signer: signer!, minors };
}

import { Lexer, type Token, type Tokens } from 'marked';
import { siteConfig } from './site-config';

/*
 * A Yoast-style SEO and readability check for blog posts, so a post
 * written by grokbot can be held to the same bar Travis used Yoast for on
 * the old WordPress site, plus a few checks Yoast doesn't make.
 *
 * Every check rates the draft the way Yoast does: good (green), ok
 * (orange) or problem (red). Each one is scored 9 / 6 / 3 like Yoast's, and
 * the two scores are the average as a percentage. A post may go live only
 * when nothing is red and both scores clear PUBLISH_MIN_* below.
 *
 * Pure: no network or database. The caller works out which internal paths
 * exist and whether external links answer (checkExternalLinks in
 * ./blog-publish.ts) and passes them in.
 */

export type Rating = 'good' | 'ok' | 'problem';

export interface CheckResult {
  id: string;
  group: 'seo' | 'readability';
  rating: Rating;
  /** Yoast's name for the check, or ours for the extras. */
  label: string;
  message: string;
}

export interface SeoDraft {
  /** The on-page headline (the H1). */
  title: string;
  /** The <title> exactly as the page will render it. */
  seoTitle: string;
  slug: string;
  metaDescription: string;
  focusKeyphrase: string;
  /** Body Markdown, without the H1. Photos are `![alt](photo:<id>)`. */
  markdown: string;
  /** The featured photo, shown above the post and on social cards. */
  hero: { alt: string; width: number | null } | null;
}

/** What a HEAD/GET of an external link found. */
export interface LinkStatus {
  state: 'ok' | 'broken' | 'unverified';
  detail: string;
}

export interface SeoContext {
  /** Every path a post may link to on this site: no host, query, fragment or trailing slash. */
  internalPaths: ReadonlySet<string>;
  /** The site's other posts, for duplicate and cannibalization checks. */
  otherPosts: ReadonlyArray<{
    slug: string;
    title: string;
    description: string;
    focusKeyphrase: string | null;
  }>;
  /** Results of checking the draft's external links; a link missing here wasn't checked. */
  linkStatus?: ReadonlyMap<string, LinkStatus>;
  /** Pixel width of each `photo:` image in the body, where known. */
  photoWidths?: ReadonlyMap<string, number>;
}

export interface SeoReport {
  passes: boolean;
  seoScore: number;
  readabilityScore: number;
  results: CheckResult[];
  stats: {
    words: number;
    sentences: number;
    paragraphs: number;
    subheadings: number;
    images: number;
    internalLinks: number;
    externalLinks: number;
    keyphraseCount: number;
    keyphraseDensity: number;
    fleschReadingEase: number;
  };
}

/** Stricter than Yoast's green (70) for SEO: a bot can always fix the oranges. */
export const PUBLISH_MIN_SEO_SCORE = 80;
export const PUBLISH_MIN_READABILITY_SCORE = 70;

/** Yoast asks for 300 words; posts under 600 read as thin next to the pages they compete with. */
export const MIN_WORDS = 600;
export const GOOD_WORDS = 900;
export const META_MIN = 120;
export const META_MAX = 156;
export const TITLE_MAX = 60;
export const HERO_MIN_WIDTH = 1200;
export const INLINE_MIN_WIDTH = 800;

/** Paths that sell a tour. Every post links to at least one. */
export function isBookingPath(path: string): boolean {
  return path === '/book' || path === '/tours' || path.startsWith('/tours/');
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

/**
 * Words that don't carry the topic. A keyphrase's other words are its
 * "content words", which is what Yoast matches on.
 */
const FUNCTION_WORDS = new Set(
  (
    'a an the and or but nor so of in on at to for from by with without into onto over under ' +
    'near about around through during before after than as is are was were be been being am ' +
    'do does did can could should would will may might must how what when where why which who ' +
    'whom whose that this these those it its your you my our we us i me he she they them their ' +
    'his her vs versus up out off if then there here all any some each every no not just very'
  ).split(' '),
);

/** Lowercase, plain-ASCII words. Hyphens split words; apostrophes don't. */
export function words(text: string): string[] {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .split(/[^a-z0-9']+/)
    .map((w) => w.replace(/^'+|'+$/g, '').replace(/'s$/, ''))
    .filter(Boolean);
}

/** Crude plural folding, so "manatees" matches "manatee" and "springs" "spring". */
export function stem(word: string): string {
  if (word.length <= 3) return word;
  if (word.endsWith('ies') && word.length > 4) return `${word.slice(0, -3)}y`;
  if (/(?:ss|sh|ch|x|z)es$/.test(word)) return word.slice(0, -2);
  if (word.endsWith('s') && !word.endsWith('ss') && !word.endsWith('us') && !word.endsWith('is')) {
    return word.slice(0, -1);
  }
  return word;
}

function contentStems(phrase: string): string[] {
  const all = words(phrase);
  const content = all.filter((w) => !FUNCTION_WORDS.has(w));
  return [...new Set((content.length ? content : all).map(stem))];
}

function stemSet(text: string): Set<string> {
  return new Set(words(text).map(stem));
}

function hasAll(text: string, stems: string[]): boolean {
  if (stems.length === 0) return false;
  const have = stemSet(text);
  return stems.every((s) => have.has(s));
}

/** Yoast's rule for headings and alt text: more than half of the content words. */
function hasMost(text: string, stems: string[]): boolean {
  if (stems.length === 0) return false;
  const have = stemSet(text);
  return stems.filter((s) => have.has(s)).length > stems.length / 2;
}

const ABBREVIATIONS =
  /\b(Capt|Mr|Mrs|Ms|Dr|St|Ft|Mt|Jr|Sr|Sgt|Lt|Col|Gen|Rev|vs|etc|approx|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec|No)\./g;
const DOT = '⁣';

/** Splits prose into sentences without breaking on "Capt.", "a.m." or "72.5". */
export function sentences(text: string): string[] {
  const guarded = text
    .replace(ABBREVIATIONS, `$1${DOT}`)
    // a.m., p.m., U.S., e.g., i.e.
    .replace(/\b(?:[A-Za-z]\.){2,}/g, (m) => m.replaceAll('.', DOT))
    .replace(/(\d)\.(\d)/g, `$1${DOT}$2`);
  return guarded
    // A new sentence starts with a capital or a number.
    .split(/(?<=[.!?…]["'”’)\]]*)\s+(?=["'“‘(\[]?[A-Z0-9])/)
    .map((s) => s.replaceAll(DOT, '.').trim())
    .filter((s) => words(s).length > 0);
}

/** Syllables in an English word, the usual heuristic for Flesch scores. */
export function syllables(word: string): number {
  let w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 0;
  if (w.length <= 3) return 1;
  w = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '');
  return Math.max(1, (w.match(/[aeiouy]{1,2}/g) ?? []).length);
}

const TRANSITION_SINGLE = new Set(
  (
    'accordingly additionally afterward afterwards albeit also although altogether another because ' +
    'besides but certainly consequently conversely despite earlier especially eventually finally ' +
    'first firstly following further furthermore generally hence however indeed initially instead ' +
    'lastly later likewise meanwhile moreover namely naturally nevertheless next nonetheless ' +
    'notably otherwise overall particularly plus previously rather regardless second secondly ' +
    'similarly simultaneously since so soon specifically still subsequently surprisingly then ' +
    'thereafter therefore third thirdly though thus too ultimately undoubtedly unless unlike until ' +
    'when whenever whereas while yet'
  ).split(' '),
);

const TRANSITION_MULTI = [
  'above all', 'after all', 'after that', 'all in all', 'as a result', 'as long as', 'as soon as',
  'as well as', 'at first', 'at last', 'at least', 'at the same time', 'because of', 'by the way',
  'even if', 'even so', 'even though', 'first of all', 'for example', 'for instance',
  'for this reason', 'in addition', 'in conclusion', 'in contrast', 'in fact', 'in general',
  'in other words', 'in particular', 'in short', 'in summary', 'in the meantime', 'in turn',
  'most importantly', 'not only', 'of course', 'on the other hand', 'once again', 'so that',
  'such as', 'that is why', 'to begin with', 'to sum up', 'what is more', 'with this in mind',
];

function hasTransition(sentence: string): boolean {
  const ws = words(sentence);
  if (ws.some((w) => TRANSITION_SINGLE.has(w))) return true;
  const joined = ` ${ws.join(' ')} `;
  return TRANSITION_MULTI.some((p) => joined.includes(` ${p} `));
}

const BE_FORMS = new Set([
  'am', 'is', 'are', 'was', 'were', 'be', 'been', 'being', "isn't", "aren't", "wasn't", "weren't",
  'get', 'gets', 'got', 'gotten', 'getting',
]);
const SKIPPABLE = new Set(['not', 'also', 'often', 'never', 'always', 'usually', 'still', 'just', 'all', 'rarely', 'sometimes']);
const IRREGULAR_PARTICIPLES = new Set(
  (
    'arisen awoken beaten become begun bent bet bitten blown born borne bought bound bred brought ' +
    'broken built burnt caught chosen come cut dealt done drawn driven drunk eaten fallen fed felt ' +
    'fought found fled flown forbidden forgotten forgiven frozen given gone grown hung heard hidden ' +
    'hit held hurt kept knelt known laid led left lent let lit lost made meant met mistaken paid put ' +
    'quit read ridden risen run said seen sought sold sent set sewn shaken shaped shed shot shown ' +
    'shrunk shut sung sunk slain slept slid spoken spent spun spread stood stolen stuck stung struck ' +
    'sworn swept swum swung taken taught torn told thought thrown understood upset woken worn won ' +
    'wound written'
  ).split(' '),
);
const NOT_PARTICIPLES = new Set(['need', 'bed', 'red', 'shed', 'hundred', 'seed', 'speed', 'feed', 'breed', 'indeed', 'sled', 'weed', 'reed', 'proceed', 'exceed', 'succeed']);

function isParticiple(w: string): boolean {
  if (IRREGULAR_PARTICIPLES.has(w)) return true;
  return w.length > 4 && w.endsWith('ed') && !NOT_PARTICIPLES.has(w);
}

/** "is protected", "were spotted", "got caught": a form of be/get, then a past participle. */
export function isPassive(sentence: string): boolean {
  const ws = words(sentence);
  for (let i = 0; i < ws.length - 1; i++) {
    if (!BE_FORMS.has(ws[i]!)) continue;
    let j = i + 1;
    while (j < ws.length && j <= i + 2 && (SKIPPABLE.has(ws[j]!) || ws[j]!.endsWith('ly'))) j++;
    if (j < ws.length && isParticiple(ws[j]!)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Markdown → structure
// ---------------------------------------------------------------------------

interface Block {
  kind: 'heading' | 'paragraph' | 'list-item';
  depth: number;
  text: string;
}

interface Parsed {
  blocks: Block[];
  images: { alt: string; href: string }[];
  links: { href: string; text: string }[];
  lists: number;
  rawHtml: number;
  tables: number;
}

function inlineText(tokens: Token[] | undefined, out: Parsed): string {
  if (!tokens) return '';
  let text = '';
  for (const t of tokens) {
    switch (t.type) {
      case 'image':
        out.images.push({ alt: (t as Tokens.Image).text, href: (t as Tokens.Image).href });
        break;
      case 'link': {
        const link = t as Tokens.Link;
        const linkText = inlineText(link.tokens, out);
        out.links.push({ href: link.href, text: linkText });
        text += linkText;
        break;
      }
      case 'html':
        out.rawHtml++;
        break;
      case 'br':
        text += ' ';
        break;
      default: {
        const withChildren = t as { tokens?: Token[]; text?: string };
        text += withChildren.tokens ? inlineText(withChildren.tokens, out) : (withChildren.text ?? '');
      }
    }
  }
  return text;
}

function walk(tokens: Token[], out: Parsed): void {
  for (const t of tokens) {
    switch (t.type) {
      case 'heading': {
        const h = t as Tokens.Heading;
        out.blocks.push({ kind: 'heading', depth: h.depth, text: inlineText(h.tokens, out).trim() });
        break;
      }
      case 'paragraph': {
        const text = inlineText((t as Tokens.Paragraph).tokens, out).trim();
        // An image on its own line isn't a paragraph of text.
        if (words(text).length) out.blocks.push({ kind: 'paragraph', depth: 0, text });
        break;
      }
      case 'list':
        out.lists++;
        for (const item of (t as Tokens.List).items) {
          const parts: string[] = [];
          for (const child of item.tokens) {
            if (child.type === 'text' || child.type === 'paragraph') {
              parts.push(inlineText((child as Tokens.Text).tokens ?? [child], out));
            } else {
              walk([child], out);
            }
          }
          const text = parts.join(' ').trim();
          if (words(text).length) out.blocks.push({ kind: 'list-item', depth: 0, text });
        }
        break;
      case 'blockquote':
        walk((t as Tokens.Blockquote).tokens, out);
        break;
      case 'html':
        out.rawHtml++;
        break;
      // Not looked inside: a table is red (plainMarkdown), so no prices,
      // links or photos in one can reach the site.
      case 'table':
        out.tables++;
        break;
      default:
        break;
    }
  }
}

function parse(markdown: string): Parsed {
  const out: Parsed = { blocks: [], images: [], links: [], lists: 0, rawHtml: 0, tables: 0 };
  walk(new Lexer().lex(markdown), out);
  return out;
}

/** `/tours/morning-shared/` and `https://crystalrivermanateefun.com/tours/morning-shared#x` → `/tours/morning-shared`. */
export function internalPath(href: string): string | null {
  let path: string;
  if (href.startsWith('/') && !href.startsWith('//')) {
    path = href;
  } else {
    try {
      const url = new URL(href);
      const host = new URL(siteConfig.url).host;
      if (url.host !== host && url.host !== `www.${host}`) return null;
      path = url.pathname + url.hash;
    } catch {
      return null;
    }
  }
  path = path.replace(/[?#].*$/, '').replace(/\/+$/, '');
  return path || '/';
}

function isExternal(href: string): boolean {
  return /^https?:\/\//i.test(href) && internalPath(href) === null;
}

/** The draft's links to other sites, once each. */
export function externalLinks(markdown: string): string[] {
  return [...new Set(parse(markdown).links.map((l) => l.href).filter(isExternal))];
}

/** The `photo:` ids the draft's body images use, in order (repeats kept). */
export function photoRefs(markdown: string): string[] {
  return parse(markdown)
    .images.filter((i) => i.href.startsWith('photo:'))
    .map((i) => i.href.slice('photo:'.length));
}

// ---------------------------------------------------------------------------
// The checks
// ---------------------------------------------------------------------------

const SCORES: Record<Rating, number> = { good: 9, ok: 6, problem: 3 };

function pct(n: number, d: number): number {
  return d === 0 ? 0 : Math.round((n / d) * 1000) / 10;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function analyzePost(draft: SeoDraft, ctx: SeoContext): SeoReport {
  const results: CheckResult[] = [];
  const add = (group: CheckResult['group'], id: string, label: string, rating: Rating, message: string) =>
    results.push({ id, group, label, rating, message });
  const seo = (id: string, label: string, rating: Rating, message: string) => add('seo', id, label, rating, message);
  const read = (id: string, label: string, rating: Rating, message: string) => add('readability', id, label, rating, message);

  const parsed = parse(draft.markdown);
  const kw = contentStems(draft.focusKeyphrase);
  const kwText = draft.focusKeyphrase.trim();

  const textBlocks = parsed.blocks.filter((b) => b.kind !== 'heading');
  const paragraphs = parsed.blocks.filter((b) => b.kind === 'paragraph');
  const subheadings = parsed.blocks.filter((b) => b.kind === 'heading' && (b.depth === 2 || b.depth === 3));
  const allSentences = textBlocks.flatMap((b) => sentences(b.text));
  const bodyWords = parsed.blocks.reduce((n, b) => n + words(b.text).length, 0);
  // Yoast counts the keyphrase anywhere in the content, headings included.
  const sentenceHits = [...subheadings.map((h) => h.text), ...allSentences].filter((s) => hasAll(s, kw));
  const density = pct(sentenceHits.length, bodyWords);

  // --- Keyphrase -----------------------------------------------------------

  if (!kwText) {
    seo('keyphraseLength', 'Keyphrase length', 'problem', 'No focus keyphrase was set. Pick the 2–4 word search phrase this post should rank for.');
  } else if (kw.length <= 4) {
    seo('keyphraseLength', 'Keyphrase length', 'good', 'Good job!');
  } else if (kw.length <= 8) {
    seo('keyphraseLength', 'Keyphrase length', 'ok', `The keyphrase has ${kw.length} content words. Searchers rarely type that many; aim for 2–4.`);
  } else {
    seo('keyphraseLength', 'Keyphrase length', 'problem', `The keyphrase has ${kw.length} content words. Cut it to the 2–4 words people actually search.`);
  }

  const intro = paragraphs[0]?.text ?? '';
  if (sentences(intro).some((s) => hasAll(s, kw))) {
    seo('keyphraseInIntroduction', 'Keyphrase in introduction', 'good', 'Well done!');
  } else if (hasAll(intro, kw)) {
    seo('keyphraseInIntroduction', 'Keyphrase in introduction', 'ok', 'The keyphrase words are in the first paragraph, but not in the same sentence. Put them together in one sentence.');
  } else {
    seo('keyphraseInIntroduction', 'Keyphrase in introduction', 'problem', 'The keyphrase isn’t in the first paragraph. Make the topic clear immediately.');
  }

  if (sentenceHits.length === 0) {
    seo('keyphraseDensity', 'Keyphrase density', 'problem', 'The keyphrase wasn’t found in the text. Use it naturally a few times.');
  } else if (density < 0.5) {
    seo('keyphraseDensity', 'Keyphrase density', 'ok', `The keyphrase was found ${plural(sentenceHits.length, 'time')} (${density}%). Aim for 0.5–3%: use it a bit more.`);
  } else if (density <= 3) {
    seo('keyphraseDensity', 'Keyphrase density', 'good', `The keyphrase was found ${plural(sentenceHits.length, 'time')} (${density}%). That’s great!`);
  } else {
    seo('keyphraseDensity', 'Keyphrase density', 'problem', `The keyphrase was found ${plural(sentenceHits.length, 'time')} (${density}%), over the 3% maximum. That reads as keyword stuffing; vary the wording.`);
  }

  const thirds = kw.length ? thirdsWithKeyphrase(allSentences, kw, bodyWords) : null;
  if (thirds !== null) {
    if (thirds === 3) seo('keyphraseDistribution', 'Keyphrase distribution', 'good', 'Good job!');
    else if (thirds === 2) seo('keyphraseDistribution', 'Keyphrase distribution', 'ok', 'One third of the post never mentions the keyphrase. Spread it through the beginning, middle and end.');
    else seo('keyphraseDistribution', 'Keyphrase distribution', 'problem', 'The keyphrase is bunched in one part of the post. Spread it through the beginning, middle and end.');
  }

  const metaHits = sentences(draft.metaDescription).filter((s) => hasAll(s, kw)).length;
  if (metaHits === 0) {
    seo('keyphraseInMetaDescription', 'Keyphrase in meta description', 'problem', 'The meta description doesn’t contain the keyphrase. Add it.');
  } else if (metaHits <= 2) {
    seo('keyphraseInMetaDescription', 'Keyphrase in meta description', 'good', 'Keyphrase or synonym appear in the meta description. Well done!');
  } else {
    seo('keyphraseInMetaDescription', 'Keyphrase in meta description', 'problem', `The meta description contains the keyphrase ${metaHits} times. Once or twice is enough.`);
  }

  const titleStems = words(draft.seoTitle).filter((w) => !FUNCTION_WORDS.has(w)).map(stem);
  if (kw.length && kw.every((s, i) => titleStems[i] === s)) {
    seo('keyphraseInTitle', 'Keyphrase in SEO title', 'good', 'The SEO title starts with the keyphrase. Good job!');
  } else if (hasAll(draft.seoTitle, kw)) {
    seo('keyphraseInTitle', 'Keyphrase in SEO title', 'ok', 'The SEO title has the keyphrase, but not at the start. Move it to the beginning.');
  } else {
    seo('keyphraseInTitle', 'Keyphrase in SEO title', 'problem', 'The SEO title doesn’t contain the keyphrase. Put it at the beginning.');
  }

  const slugStems = draft.slug.split('-').map(stem);
  const slugHits = kw.filter((s) => slugStems.includes(s)).length;
  if (kw.length && slugHits === kw.length) {
    seo('keyphraseInSlug', 'Keyphrase in slug', 'good', 'Great work!');
  } else if (slugHits > kw.length / 2) {
    seo('keyphraseInSlug', 'Keyphrase in slug', 'ok', 'The slug has some of the keyphrase. Use all of it.');
  } else {
    seo('keyphraseInSlug', 'Keyphrase in slug', 'problem', 'The slug doesn’t contain the keyphrase. Make it the keyphrase, hyphenated.');
  }

  if (subheadings.length === 0) {
    seo('keyphraseInSubheadings', 'Keyphrase in subheadings', 'problem', 'There are no H2 or H3 subheadings. Add some, and use the keyphrase in a few of them.');
  } else {
    const share = pct(subheadings.filter((h) => hasMost(h.text, kw)).length, subheadings.length);
    if (share >= 30 && share <= 75) {
      seo('keyphraseInSubheadings', 'Keyphrase in subheadings', 'good', 'Your H2 and H3 subheadings reflect the topic of your copy. Good job!');
    } else if (share > 75) {
      seo('keyphraseInSubheadings', 'Keyphrase in subheadings', 'ok', `${share}% of subheadings use the keyphrase. Over 75% looks over-optimized; reword some.`);
    } else if (share > 0) {
      seo('keyphraseInSubheadings', 'Keyphrase in subheadings', 'ok', `Only ${share}% of subheadings use the keyphrase. Aim for 30–75%.`);
    } else {
      seo('keyphraseInSubheadings', 'Keyphrase in subheadings', 'problem', 'None of the subheadings use the keyphrase. Use it in 30–75% of them.');
    }
  }

  const alts = [...(draft.hero ? [draft.hero.alt] : []), ...parsed.images.map((i) => i.alt)];
  const altHits = alts.filter((a) => hasMost(a, kw)).length;
  if (alts.length === 0) {
    seo('keyphraseInImageAlt', 'Image keyphrase', 'problem', 'There are no images to carry the keyphrase. Add photos with descriptive alt text.');
  } else if (altHits === 0) {
    seo('keyphraseInImageAlt', 'Image keyphrase', 'problem', 'No image alt text mentions the keyphrase. Work it into at least one, where it describes the photo honestly.');
  } else if (alts.length < 5 || (pct(altHits, alts.length) >= 30 && pct(altHits, alts.length) <= 70)) {
    seo('keyphraseInImageAlt', 'Image keyphrase', 'good', 'Good job!');
  } else {
    seo('keyphraseInImageAlt', 'Image keyphrase', 'ok', `${altHits} of ${alts.length} alt texts use the keyphrase. With 5 or more images, aim for 30–70%.`);
  }

  const kwKey = kw.slice().sort().join(' ');
  const sameKeyphrase = ctx.otherPosts.find(
    (p) => p.focusKeyphrase && contentStems(p.focusKeyphrase).sort().join(' ') === kwKey,
  );
  const titleCovers = ctx.otherPosts.find((p) => hasAll(p.title, kw));
  if (sameKeyphrase) {
    seo('previouslyUsedKeyphrase', 'Previously used keyphrase', 'problem', `“${sameKeyphrase.title}” (/news/${sameKeyphrase.slug}) already targets this keyphrase. Two posts on one keyphrase compete with each other; pick another.`);
  } else if (titleCovers) {
    seo('previouslyUsedKeyphrase', 'Previously used keyphrase', 'ok', `“${titleCovers.title}” (/news/${titleCovers.slug}) already covers this keyphrase in its title. Make sure this post takes a different angle, and link to it.`);
  } else {
    seo('previouslyUsedKeyphrase', 'Previously used keyphrase', 'good', 'You’ve not used this keyphrase before, very good.');
  }

  // --- Length, links, images ------------------------------------------------

  if (bodyWords >= GOOD_WORDS) {
    seo('textLength', 'Text length', 'good', `The text contains ${bodyWords} words. Good job!`);
  } else if (bodyWords >= MIN_WORDS) {
    seo('textLength', 'Text length', 'ok', `The text contains ${bodyWords} words. ${GOOD_WORDS}+ words covers a topic well enough to outrank the competition.`);
  } else {
    seo('textLength', 'Text length', 'problem', `The text contains ${bodyWords} words, under our ${MIN_WORDS}-word minimum (Yoast’s is 300). Add more useful detail.`);
  }

  const external = parsed.links.filter((l) => isExternal(l.href));
  const broken = external.filter((l) => ctx.linkStatus?.get(l.href)?.state === 'broken');
  if (external.length === 0) {
    seo('outboundLinks', 'Outbound links', 'problem', 'No outbound links appear in this page. Link to an authoritative source (FWC, USFWS, Save the Manatee Club, a state park).');
  } else if (broken.length) {
    seo('outboundLinks', 'Outbound links', 'problem', `Broken outbound ${broken.length === 1 ? 'link' : 'links'}: ${broken.map((l) => `${l.href} (${ctx.linkStatus?.get(l.href)?.detail})`).join(', ')}. Replace with a page that loads.`);
  } else {
    seo('outboundLinks', 'Outbound links', 'good', 'Good job!');
  }

  const internal = parsed.links
    .map((l) => ({ ...l, path: internalPath(l.href) }))
    .filter((l): l is typeof l & { path: string } => l.path !== null && l.path !== `/news/${draft.slug}`);
  const unknown = internal.filter((l) => !ctx.internalPaths.has(l.path));
  const bookingLinks = internal.filter((l) => isBookingPath(l.path));
  const otherInternal = internal.filter((l) => !isBookingPath(l.path));
  if (unknown.length) {
    seo('internalLinks', 'Internal links', 'problem', `These internal links go to pages that don’t exist: ${unknown.map((l) => l.href).join(', ')}. Use paths from get_blog_brief.`);
  } else if (internal.length === 0) {
    seo('internalLinks', 'Internal links', 'problem', 'No internal links appear in this page. Link to /tours or /book, and to a related post or page.');
  } else if (bookingLinks.length && otherInternal.length) {
    seo('internalLinks', 'Internal links', 'good', 'You have enough internal links. Good job!');
  } else if (!bookingLinks.length) {
    seo('internalLinks', 'Internal links', 'ok', 'None of the internal links lead to a tour. Link /tours, a tour page or /book where it fits.');
  } else {
    seo('internalLinks', 'Internal links', 'ok', 'Add a link to a related post or page too (the FAQ, the About page, another post), not just the tours.');
  }

  const competing = parsed.links.filter((l) => kw.length && hasAll(l.text, kw));
  if (competing.length) {
    seo('competingLinks', 'Link keyphrase', 'problem', `Link text “${competing[0]!.text}” uses this post’s keyphrase, which tells search engines another page is about it. Reword the link.`);
  } else {
    seo('competingLinks', 'Link keyphrase', 'good', 'No links use your keyphrase as their text. Good.');
  }

  const meta = draft.metaDescription.trim();
  if (!meta) {
    seo('metaDescriptionLength', 'Meta description length', 'problem', 'No meta description has been specified.');
  } else if (meta.length < META_MIN) {
    seo('metaDescriptionLength', 'Meta description length', 'ok', `The meta description is ${meta.length} characters. Use ${META_MIN}–${META_MAX} so it fills the search result.`);
  } else if (meta.length <= META_MAX) {
    seo('metaDescriptionLength', 'Meta description length', 'good', 'Well done!');
  } else {
    seo('metaDescriptionLength', 'Meta description length', 'ok', `The meta description is ${meta.length} characters; Google cuts it off after about ${META_MAX}.`);
  }

  const titleLength = draft.seoTitle.trim().length;
  if (titleLength < 30) {
    seo('seoTitleWidth', 'SEO title width', 'ok', `The SEO title is ${titleLength} characters. Use the space: ${30}–${TITLE_MAX}.`);
  } else if (titleLength <= TITLE_MAX) {
    seo('seoTitleWidth', 'SEO title width', 'good', 'Good job!');
  } else if (titleLength <= 70) {
    seo('seoTitleWidth', 'SEO title width', 'ok', `The SEO title is ${titleLength} characters; Google shows about ${TITLE_MAX}.`);
  } else {
    seo('seoTitleWidth', 'SEO title width', 'problem', `The SEO title is ${titleLength} characters. Keep it to ${TITLE_MAX} or Google will cut it off.`);
  }

  const h1s = parsed.blocks.filter((b) => b.kind === 'heading' && b.depth === 1);
  if (h1s.length) {
    seo('singleH1', 'Single title', 'problem', 'The body has an H1 (#). The post title is already the H1; use ## for sections.');
  } else {
    seo('singleH1', 'Single title', 'good', 'You don’t have multiple H1 headings, well done!');
  }

  const photoImages = parsed.images.filter((i) => i.href.startsWith('photo:'));
  const foreignImages = parsed.images.filter((i) => !i.href.startsWith('photo:'));
  const totalImages = (draft.hero ? 1 : 0) + parsed.images.length;
  const wantImages = Math.min(6, Math.max(2, Math.ceil(bodyWords / 350)));
  if (foreignImages.length) {
    seo('images', 'Images', 'problem', `Images must be photos from list_blog_photos (photo:<id>), not ${foreignImages[0]!.href}.`);
  } else if (!draft.hero) {
    seo('images', 'Images', 'problem', 'No featured photo. Pick one: it heads the post and is the picture on Google and social media.');
  } else if (photoImages.length === 0) {
    seo('images', 'Images', 'problem', 'No photos in the body. Add at least one where it illustrates the text.');
  } else if (totalImages >= wantImages) {
    seo('images', 'Images', 'good', `${plural(totalImages, 'photo')}. Good job!`);
  } else {
    seo('images', 'Images', 'ok', `${plural(totalImages, 'photo')} for ${bodyWords} words. About one per 350 words (${wantImages} here) keeps readers going.`);
  }

  const badAlt = alts.filter(
    (a) =>
      a.trim().length < 10 ||
      a.trim().length > 125 ||
      /\.(jpe?g|png|heic|webp|gif)$/i.test(a.trim()) ||
      /^(img|dsc|gopr|gp|pxl|photo|image)[\s_-]?\d+/i.test(a.trim()) ||
      /^(an? )?(image|photo|picture|pic) of\b/i.test(a.trim()),
  );
  if (alts.length && badAlt.length) {
    seo('altText', 'Alt text', 'problem', `Alt text should say what the photo shows in 10–125 characters, without “photo of”: fix “${badAlt[0]}”.`);
  } else if (alts.length) {
    seo('altText', 'Alt text', 'good', 'Every photo has descriptive alt text.');
  }

  const smallInline = photoImages.filter((i) => (ctx.photoWidths?.get(i.href.slice('photo:'.length)) ?? Infinity) < INLINE_MIN_WIDTH);
  if (draft.hero && draft.hero.width !== null && draft.hero.width < HERO_MIN_WIDTH) {
    seo('imageSize', 'Image size', 'problem', `The featured photo is ${draft.hero.width}px wide. Google Discover and social cards want ${HERO_MIN_WIDTH}px or more; pick a bigger one.`);
  } else if (smallInline.length) {
    seo('imageSize', 'Image size', 'ok', `Some body photos are under ${INLINE_MIN_WIDTH}px wide and will look soft. Pick larger ones if there are any.`);
  } else if (draft.hero) {
    seo('imageSize', 'Image size', 'good', 'The photos are big enough to look sharp.');
  }

  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(draft.slug)) {
    seo('slugFormat', 'Slug', 'problem', 'The slug may only use lowercase letters, numbers and single hyphens.');
  } else if (draft.slug.length > 60 || draft.slug.split('-').length > 6) {
    seo('slugFormat', 'Slug', 'ok', 'The slug is long. Short slugs (up to 5 or 6 words) are easier to share and read in search results.');
  } else {
    seo('slugFormat', 'Slug', 'good', 'The slug is short and readable.');
  }

  const skipped = parsed.blocks.some((b, i, all) => {
    if (b.kind !== 'heading') return false;
    const prev = all.slice(0, i).reverse().find((x) => x.kind === 'heading');
    return b.depth > (prev?.depth ?? 1) + 1;
  });
  const h2s = parsed.blocks.filter((b) => b.kind === 'heading' && b.depth === 2).length;
  if (skipped) {
    seo('headingStructure', 'Heading structure', 'ok', 'A heading skips a level (an H4 under an H2, say). Go ## then ###.');
  } else if (bodyWords >= MIN_WORDS && h2s < 2) {
    seo('headingStructure', 'Heading structure', 'ok', 'Use at least two ## sections so readers (and Google) can see the outline.');
  } else {
    seo('headingStructure', 'Heading structure', 'good', 'The headings make a clean outline.');
  }

  const everything = [draft.title, draft.metaDescription, ...parsed.blocks.map((b) => b.text)].join(' ');
  if (/crystal river/i.test(everything)) {
    seo('localRelevance', 'Local relevance', 'good', 'The post ties the topic to Crystal River.');
  } else {
    seo('localRelevance', 'Local relevance', 'problem', 'The post never mentions Crystal River. Tie the topic back to Crystal River, Kings Bay or Citrus County: that’s who we want to rank for.');
  }

  if (/\$\s?\d/.test(everything)) {
    seo('noPrices', 'Prices', 'problem', 'The post quotes a price. Prices change with the season and would go stale; link to /tours instead.');
  } else {
    seo('noPrices', 'Prices', 'good', 'No prices to go out of date.');
  }

  if (parsed.lists > 0) {
    seo('lists', 'Lists', 'good', 'The post has a list, which Google likes to quote in featured snippets.');
  } else {
    seo('lists', 'Lists', 'ok', 'Add a bulleted or numbered list where it fits (what to bring, steps, tips). Google often quotes them.');
  }

  const unsafeLinks = parsed.links.filter((l) => !/^(https?:\/\/|\/(?!\/)|#)/i.test(l.href));
  if (parsed.rawHtml > 0) {
    seo('plainMarkdown', 'Plain Markdown', 'problem', 'The body contains raw HTML. Write plain Markdown only.');
  } else if (parsed.tables > 0) {
    // The post pages have no table styles, and a table doesn't fit a phone.
    seo('plainMarkdown', 'Plain Markdown', 'problem', 'The body contains a table. Tables don’t fit a phone screen on the site; use a list or ### sections instead.');
  } else if (unsafeLinks.length) {
    seo('plainMarkdown', 'Plain Markdown', 'problem', `Links must be https:// or a site path, not ${unsafeLinks[0]!.href}.`);
  }

  const sameTitle = ctx.otherPosts.find((p) => p.title.trim().toLowerCase() === draft.title.trim().toLowerCase());
  const sameMeta = ctx.otherPosts.find((p) => p.description.trim().toLowerCase() === meta.toLowerCase());
  if (sameTitle || sameMeta) {
    seo('unique', 'Unique title and description', 'problem', `“${(sameTitle ?? sameMeta)!.title}” already uses this ${sameTitle ? 'title' : 'meta description'}. Every page needs its own.`);
  } else {
    seo('unique', 'Unique title and description', 'good', 'The title and meta description are unique on the site.');
  }

  // --- Readability ----------------------------------------------------------

  const sections: number[] = [];
  let running = 0;
  for (const b of parsed.blocks) {
    if (b.kind === 'heading') {
      sections.push(running);
      running = 0;
    } else {
      running += words(b.text).length;
    }
  }
  sections.push(running);
  const longestSection = Math.max(...sections);
  if (subheadings.length === 0 && bodyWords > 300) {
    read('subheadingDistribution', 'Subheading distribution', 'problem', 'You aren’t using any subheadings, although your text is rather long. Add ## subheadings.');
  } else if (longestSection > 350) {
    read('subheadingDistribution', 'Subheading distribution', 'problem', `One section runs ${longestSection} words without a subheading. Break it up (300 words at most).`);
  } else if (longestSection > 300) {
    read('subheadingDistribution', 'Subheading distribution', 'ok', `One section runs ${longestSection} words without a subheading. Keep sections to 300 words.`);
  } else {
    read('subheadingDistribution', 'Subheading distribution', 'good', 'Great job!');
  }

  const longestParagraph = Math.max(0, ...paragraphs.map((p) => words(p.text).length));
  if (longestParagraph > 200) {
    read('paragraphLength', 'Paragraph length', 'problem', `A paragraph runs ${longestParagraph} words. Keep paragraphs under 150 words.`);
  } else if (longestParagraph > 150) {
    read('paragraphLength', 'Paragraph length', 'ok', `A paragraph runs ${longestParagraph} words. Keep paragraphs under 150 words.`);
  } else {
    read('paragraphLength', 'Paragraph length', 'good', 'None of the paragraphs are too long. Great job!');
  }

  const longSentences = pct(allSentences.filter((s) => words(s).length > 20).length, allSentences.length);
  if (longSentences > 30) {
    read('sentenceLength', 'Sentence length', 'problem', `${longSentences}% of sentences have more than 20 words; keep it under 25%. Split the long ones.`);
  } else if (longSentences > 25) {
    read('sentenceLength', 'Sentence length', 'ok', `${longSentences}% of sentences have more than 20 words; keep it under 25%.`);
  } else {
    read('sentenceLength', 'Sentence length', 'good', 'Great!');
  }

  const proseWords = textBlocks.flatMap((b) => words(b.text));
  const flesch = proseWords.length && allSentences.length
    ? Math.round(
        (206.835 -
          1.015 * (proseWords.length / allSentences.length) -
          84.6 * (proseWords.reduce((n, w) => n + syllables(w), 0) / proseWords.length)) *
          10,
      ) / 10
    : 0;
  if (flesch >= 60) {
    read('fleschReadingEase', 'Flesch Reading Ease', 'good', `The copy scores ${flesch} in the Flesch Reading Ease test, which is considered fairly easy to read. Good job!`);
  } else if (flesch >= 50) {
    read('fleschReadingEase', 'Flesch Reading Ease', 'ok', `The copy scores ${flesch} in the Flesch Reading Ease test, which is considered fairly difficult. Use shorter sentences and simpler words.`);
  } else {
    read('fleschReadingEase', 'Flesch Reading Ease', 'problem', `The copy scores ${flesch} in the Flesch Reading Ease test, which is considered difficult to read. Use shorter sentences and simpler words.`);
  }

  const passive = pct(allSentences.filter(isPassive).length, allSentences.length);
  if (passive > 15) {
    read('passiveVoice', 'Passive voice', 'problem', `${passive}% of sentences use the passive voice; keep it to 10%. Say who does what.`);
  } else if (passive > 10) {
    read('passiveVoice', 'Passive voice', 'ok', `${passive}% of sentences use the passive voice; keep it to 10%.`);
  } else {
    read('passiveVoice', 'Passive voice', 'good', 'You’re using enough active voice. That’s great!');
  }

  const transitions = pct(allSentences.filter(hasTransition).length, allSentences.length);
  if (transitions >= 30) {
    read('transitionWords', 'Transition words', 'good', 'Well done!');
  } else if (transitions >= 20) {
    read('transitionWords', 'Transition words', 'ok', `Only ${transitions}% of sentences contain transition words (also, because, for example, then…); aim for 30%.`);
  } else {
    read('transitionWords', 'Transition words', 'problem', `Only ${transitions}% of sentences contain transition words (also, because, for example, then…). Use more of them.`);
  }

  let runs = 0;
  for (const p of paragraphs) {
    const firsts = sentences(p.text).map((s) => words(s)[0] ?? '');
    let streak = 1;
    for (let i = 1; i < firsts.length; i++) {
      streak = firsts[i] && firsts[i] === firsts[i - 1] ? streak + 1 : 1;
      if (streak === 3) runs++;
    }
  }
  if (runs >= 2) {
    read('consecutiveSentences', 'Consecutive sentences', 'problem', `${runs} places have three or more sentences in a row starting with the same word. Mix things up!`);
  } else if (runs === 1) {
    read('consecutiveSentences', 'Consecutive sentences', 'ok', 'Three or more sentences in a row start with the same word. Mix things up!');
  } else {
    read('consecutiveSentences', 'Consecutive sentences', 'good', 'There is enough variety in your sentences. That’s great!');
  }

  const score = (group: CheckResult['group']) => {
    const rs = results.filter((r) => r.group === group);
    return rs.length ? Math.round((rs.reduce((n, r) => n + SCORES[r.rating], 0) / (rs.length * 9)) * 100) : 0;
  };
  const seoScore = score('seo');
  const readabilityScore = score('readability');

  return {
    passes:
      !results.some((r) => r.rating === 'problem') &&
      seoScore >= PUBLISH_MIN_SEO_SCORE &&
      readabilityScore >= PUBLISH_MIN_READABILITY_SCORE,
    seoScore,
    readabilityScore,
    results,
    stats: {
      words: bodyWords,
      sentences: allSentences.length,
      paragraphs: paragraphs.length,
      subheadings: subheadings.length,
      images: totalImages,
      internalLinks: internal.length,
      externalLinks: external.length,
      keyphraseCount: sentenceHits.length,
      keyphraseDensity: density,
      fleschReadingEase: flesch,
    },
  };
}

/** In how many thirds of the post the keyphrase appears, or null if it's too short to judge. */
function thirdsWithKeyphrase(all: string[], kw: string[], bodyWords: number): number | null {
  if (bodyWords < 300 || all.length < 6) return null;
  const size = Math.ceil(all.length / 3);
  let thirds = 0;
  for (let i = 0; i < 3; i++) {
    if (all.slice(i * size, (i + 1) * size).some((s) => hasAll(s, kw))) thirds++;
  }
  return thirds;
}

/** The report as short lines a model can act on: problems first, then improvements. */
export function summarizeReport(report: SeoReport): string {
  const line = (r: CheckResult) => `- [${r.rating === 'problem' ? 'RED' : r.rating === 'ok' ? 'ORANGE' : 'GREEN'}] ${r.label}: ${r.message}`;
  const by = (rating: Rating) => report.results.filter((r) => r.rating === rating).map(line);
  const verdict = report.passes
    ? 'PASSES: ready to publish.'
    : `DOES NOT PASS yet. To pass: no RED checks, SEO score ${PUBLISH_MIN_SEO_SCORE}+ and readability ${PUBLISH_MIN_READABILITY_SCORE}+.`;
  return [
    `${verdict} SEO score ${report.seoScore}/100, readability ${report.readabilityScore}/100.`,
    ...by('problem'),
    ...by('ok'),
    ...by('good'),
  ].join('\n');
}

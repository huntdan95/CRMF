import 'server-only';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { FieldValue, Timestamp, type QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { Lexer, walkTokens, type Tokens } from 'marked';
import { marinaNow } from './availability';
import {
  deleteStoredImages,
  fileSlug,
  getBlogPhoto,
  importBodyPhoto,
  importHeroPhoto,
  listBlogPhotos,
  parsePhotoId,
} from './blog-photos';
import {
  CADENCE_DAYS,
  REVIEW_WINDOW_DAYS,
  cadenceOf,
  holdsItsPlace,
  type Cadence,
  type PostRow,
} from './blog-rules';
import { liveFaqSections } from './faq';
import { adminDb, adminStorage } from './firebase/admin';
import type { NewsImage, NewsPostDoc, NewsPostStatus } from './firebase/types';
import { emailBodyHtml, fileSlugs, getAllPosts } from './news';
import { kindPriceRanges } from './pricing';
import {
  GOOD_WORDS,
  HERO_MIN_WIDTH,
  META_MAX,
  META_MIN,
  MIN_WORDS,
  PUBLISH_MIN_READABILITY_SCORE,
  PUBLISH_MIN_SEO_SCORE,
  TITLE_MAX,
  analyzePost,
  externalLinks,
  photoRefs,
  summarizeReport,
  type LinkStatus,
  type SeoContext,
  type SeoDraft,
  type SeoReport,
} from './seo-check';
import { fetchSiteSettings } from './settings-server';
import { siteConfig } from './site-config';
import { wetsuitSizesFrom } from './site-settings';
import { fetchTourCatalog } from './tours-server';

/*
 * Grokbot's blog: what it needs to write a post (blogBrief), the Yoast-style
 * check (checkPost), and submitting a draft (submitPost), which copies the
 * photos from Drive, writes `newsPosts/{slug}` as `pending-review` and asks
 * the email function to send Travis a copy. Nothing goes on the site until
 * he approves it (reviewPost: the review page or Admin → Blog). The MCP
 * tools in src/lib/mcp/blog-tools.ts are thin wrappers over these.
 *
 * Every other week: see cadenceOf in ./blog-rules.ts. The automation runs
 * weekly (Grok's schedules have no "every two weeks") and the off-week run
 * is told to stop.
 */

export { CADENCE_DAYS, REVIEW_WINDOW_DAYS };

export interface PostInput {
  title: string;
  seoTitle?: string;
  slug?: string;
  metaDescription: string;
  focusKeyphrase: string;
  featuredPhoto: { photoId: string; alt: string };
  markdown: string;
}

// ---------------------------------------------------------------------------
// Cadence and the review queue
// ---------------------------------------------------------------------------

const ROW_FIELDS = ['title', 'status', 'submittedAt', 'reviewedAt', 'reviewNote'] as const;

function rowOf(d: QueryDocumentSnapshot): PostRow {
  return {
    slug: d.id,
    title: d.get('title') as string,
    status: d.get('status') as NewsPostStatus,
    submittedAt: (d.get('submittedAt') as Timestamp | undefined)?.toMillis() ?? 0,
    reviewedAt: (d.get('reviewedAt') as Timestamp | null | undefined)?.toMillis() ?? null,
    reviewNote: (d.get('reviewNote') as string | null | undefined) ?? null,
  };
}

async function postRows(): Promise<PostRow[]> {
  const snap = await adminDb().collection('newsPosts').select(...ROW_FIELDS).get();
  return snap.docs.map(rowOf);
}

export async function blogCadence(now = Date.now()): Promise<Cadence> {
  return cadenceOf(await postRows(), now);
}

// ---------------------------------------------------------------------------
// The site, as a post sees it
// ---------------------------------------------------------------------------

export interface LinkablePage {
  path: string;
  title: string;
  about: string;
}

const STATIC_PAGES: LinkablePage[] = [
  { path: '/', title: 'Home', about: 'Crystal River manatee tours with Capt. Travis: the main landing page.' },
  { path: '/tours', title: 'Manatee tours', about: 'Every shared and private tour, with times. The best general link for “book a tour”.' },
  { path: '/book', title: 'Book a tour', about: 'Live availability: pick a date and a tour.' },
  { path: '/about', title: 'About Capt. Travis', about: 'Travis’s story (/about#captain), manatee manners (/about#manners), the Crystal River area (/about#area).' },
  { path: '/faq', title: 'FAQ', about: 'What to bring, ages, wetsuits, water temperature, the rules, weather and cancellations.' },
  { path: '/gallery', title: 'Photo gallery', about: 'Photos from the tours.' },
  { path: '/reviews', title: 'Guest reviews', about: 'What guests say about the tours.' },
  { path: '/contact', title: 'Contact', about: 'Phone and the contact form.' },
  { path: '/news', title: 'News', about: 'Every post.' },
  { path: '/cancellation-policy', title: 'Cancellation policy', about: 'Refunds and rescheduling.' },
];

async function linkablePages(): Promise<{ pages: LinkablePage[]; posts: LinkablePage[] }> {
  const [{ tours }, posts] = await Promise.all([fetchTourCatalog(), getAllPosts()]);
  return {
    pages: [
      ...STATIC_PAGES,
      ...tours
        .filter((t) => t.active)
        .map((t) => ({
          path: `/tours/${t.slug}`,
          title: t.name,
          about: `${t.startTimeDisplay}–${t.endTimeDisplay}, ${t.type === 'shared' ? 'shared (seats sold per person)' : 'private (the whole boat)'}.`,
        })),
    ],
    posts: posts.map((p) => ({ path: `/news/${p.slug}`, title: p.title, about: p.description })),
  };
}

/**
 * Every post that holds its place (hidden ones and drafts awaiting review
 * included; declined ones not), for the duplicate checks.
 */
async function everyPost(): Promise<SeoContext['otherPosts']> {
  const [published, docs] = await Promise.all([
    getAllPosts(),
    adminDb().collection('newsPosts').select('title', 'description', 'focusKeyphrase', 'status', 'submittedAt').get(),
  ]);
  const bySlug = new Map<string, SeoContext['otherPosts'][number]>();
  for (const p of published) {
    bySlug.set(p.slug, { slug: p.slug, title: p.title, description: p.description, focusKeyphrase: p.focusKeyphrase });
  }
  for (const d of docs.docs) {
    if (!holdsItsPlace(d.get('status') as NewsPostStatus, d.get('submittedAt')?.toMillis?.() ?? 0)) continue;
    bySlug.set(d.id, {
      slug: d.id,
      title: d.get('title') as string,
      description: d.get('description') as string,
      focusKeyphrase: (d.get('focusKeyphrase') as string | undefined) ?? null,
    });
  }
  return [...bySlug.values()];
}

/**
 * Evergreen ideas, with the months they suit. Grokbot picks one that's in
 * season and not covered yet, or its own.
 */
const TOPIC_IDEAS: { topic: string; months: number[] }[] = [
  { topic: 'When manatee season starts in Crystal River, and what each month is like', months: [9, 10, 11, 12] },
  { topic: 'What to wear (and bring) to swim with manatees in winter', months: [10, 11, 12, 1, 2] },
  { topic: 'Why cold mornings are the best time to see manatees in Kings Bay', months: [11, 12, 1, 2] },
  { topic: 'Manatee manners: the rules for swimming with manatees, and why they matter', months: [] },
  { topic: 'First time snorkeling? A beginner’s guide to a manatee tour', months: [] },
  { topic: 'Shared or private manatee tour: which suits your group', months: [] },
  { topic: 'Bringing kids on a manatee tour: a family guide', months: [3, 4, 6, 7] },
  { topic: 'Manatee tours in summer: what’s different when the Gulf warms up', months: [4, 5, 6, 7, 8] },
  { topic: 'Manatee calves: how mothers raise their young', months: [3, 4, 5] },
  { topic: 'Photographing manatees: getting good shots without disturbing them', months: [] },
  { topic: 'The springs of Kings Bay and why they keep manatees warm', months: [11, 12, 1, 2, 3] },
  { topic: 'Planning a day in Crystal River around your manatee tour', months: [] },
  { topic: 'How Crystal River became the only place in the U.S. you can swim with manatees', months: [] },
  { topic: 'What a manatee tour looks like, from the dock to the water', months: [] },
  { topic: 'Rain, fog or cold: what weather means for your tour', months: [11, 12, 1, 2] },
  { topic: 'Manatees and boats: how boaters and swimmers help protect them', months: [] },
];

export async function blogBrief() {
  const [cadence, links, photos] = await Promise.all([
    blogCadence(),
    linkablePages(),
    listBlogPhotos({ limit: 0, includeUsed: false }),
  ]);
  const posts = await getAllPosts();
  const month = Number(marinaNow().date.slice(5, 7));
  const [{ tours, seasons }, settings] = await Promise.all([fetchTourCatalog(), fetchSiteSettings()]);

  return {
    due: cadence.due,
    status: cadence.status,
    cadence:
      `One post every ${CADENCE_DAYS} days, and Travis approves each one before it goes on the site. ` +
      `While a draft waits for him (up to ${REVIEW_WINDOW_DAYS} days) nothing new is written, so running weekly is fine.`,
    review: {
      waitingForTravis: cadence.pending,
      recentlyDeclined: cadence.declined,
    },
    howToPublish: [
      '1. Pick a topic not already covered (see existingPosts and topicIdeas) and a focus keyphrase of 2–4 words that people actually search, e.g. “manatee season crystal river”. If Travis declined a recent draft, read his note in review.recentlyDeclined.',
      '2. list_blog_photos, then view_blog_photo on a few. Pick a featured photo (landscape, at least 1200px wide) and 1–4 more for the body.',
      '3. Write the post (rules below). Body photos go in as ![alt text](photo:<id>).',
      '4. check_blog_post. Fix every RED, improve the ORANGEs, and check again until it passes.',
      '5. submit_blog_post with exactly what passed. Travis gets a copy by email and approves it; it goes on the site only then. You’re done for this run.',
    ],
    rules: [
      `Length: at least ${MIN_WORDS} words; ${GOOD_WORDS}+ is better. Yoast’s minimum is 300.`,
      'Focus keyphrase: 2–4 words, not used by another post. Put it in the first sentence or two, the SEO title (at the start), the meta description, the slug, 30–75% of the ## subheadings and at least one alt text. Use it about once per 150–200 words (0.5–3% density), spread through the post. Never as link text.',
      `SEO title: ${TITLE_MAX} characters at most, starting with the keyphrase. It’s the whole <title>; nothing is added to it. The post title (H1) can be longer and friendlier.`,
      `Meta description: ${META_MIN}–${META_MAX} characters, with the keyphrase once, written to make someone click.`,
      'Slug: the keyphrase, lowercase and hyphenated, 6 words at most.',
      'Structure: no # heading (the title is the H1). Use ## sections, ### inside them, a new subheading at least every 300 words, and at least one bulleted or numbered list.',
      'Readability: paragraphs under 150 words, at most a quarter of sentences over 20 words, Flesch Reading Ease 60+, passive voice in 10% of sentences or fewer, transition words (also, because, for example, then…) in 30% or more, and no three sentences in a row starting with the same word.',
      'Links: at least one to a tour page, /tours or /book, plus at least one to another post or page from linkablePages. At least one https:// link to an authoritative outside source (FWC, USFWS, Save the Manatee Club, Florida State Parks, NOAA). Every link must work.',
      `Photos: a featured photo at least ${HERO_MIN_WIDTH}px wide, plus at least one in the body (about one per 350 words). Alt text says what the photo shows in 10–125 characters, never “photo of”, never a file name. Prefer photos where manatees, the water, the boat or Capt. Travis are the subject; skip any where a guest’s face is the main subject, and any where a child is.`,
      'Local: tie the topic to Crystal River and Kings Bay.',
      'Facts: use only the facts below and well-established public facts about manatees. Don’t quote prices (they change by season; link /tours), don’t invent guest stories, numbers or dates, never name guests, and don’t contradict the FAQ. Manatees are never touched or chased.',
      'Voice: warm and plain, like Capt. Travis talking to a guest. “We” for the business.',
      'Plain Markdown only: no HTML, no tables, no outside images.',
      `To submit: no RED checks, SEO score ${PUBLISH_MIN_SEO_SCORE}+ and readability ${PUBLISH_MIN_READABILITY_SCORE}+ out of 100.`,
    ],
    site: {
      name: siteConfig.name,
      captain: siteConfig.captain.fullName,
      marina: `${siteConfig.marina.name}, ${siteConfig.marina.streetAddress}, ${siteConfig.marina.city}, ${siteConfig.marina.region}`,
      phone: siteConfig.contact.phone,
      boat: 'One pontoon boat, six guests at most.',
    },
    tours: tours
      .filter((t) => t.active)
      .map((t) => ({ name: t.name, path: `/tours/${t.slug}`, time: `${t.startTimeDisplay}–${t.endTimeDisplay}`, type: t.type, included: t.included })),
    linkablePages: links.pages,
    existingPosts: posts.map((p) => ({
      title: p.title,
      path: `/news/${p.slug}`,
      date: p.date.slice(0, 10),
      focusKeyphrase: p.focusKeyphrase,
      description: p.description,
    })),
    topicIdeas: TOPIC_IDEAS.map((t) => ({ topic: t.topic, inSeason: t.months.length === 0 || t.months.includes(month) })),
    // The FAQ as /faq shows it: departure times from Admin → Tours and
    // wetsuit sizes from Admin → Settings, so a post doesn't promise a size
    // Travis no longer stocks. Prices are left out (see Facts above).
    facts: liveFaqSections({
      prices: kindPriceRanges(tours, marinaNow().date, seasons),
      tours,
      wetsuitSizes: wetsuitSizesFrom(settings),
    })
      .filter((s) => s.id !== 'prices')
      .flatMap((s) => s.faqs.map((f) => ({ q: f.q, a: f.a }))),
    photos: {
      available: photos.total,
      notes: photos.notes,
      ...(photos.shareWith && { shareMorePhotosWith: photos.shareWith }),
    },
  };
}

// ---------------------------------------------------------------------------
// Checking a draft
// ---------------------------------------------------------------------------

const LINK_TIMEOUT_MS = 8000;
const MAX_REDIRECTS = 5;
const USER_AGENT = `Mozilla/5.0 (compatible; CrystalRiverManateeFunLinkCheck/1.0; +${siteConfig.url})`;

/**
 * Only public https hosts are fetched: no IPs, localhost or internal names.
 * `href` may be relative to `base` (a redirect's Location).
 */
function fetchable(href: string, base?: URL): URL | null {
  try {
    const url = new URL(href, base);
    // `metadata.google.internal.` is the same host as `metadata.google.internal`,
    // and a name without a dot (`metadata`) can only be a local one.
    const host = url.hostname.replace(/\.+$/, '');
    if (url.protocol !== 'https:') return null;
    if (!host.includes('.') || host === 'localhost' || /\.(local|internal|localhost)$/.test(host) || /^[\d.]+$/.test(host) || host.includes(':')) return null;
    return url;
  } catch {
    return null;
  }
}

async function probe(href: string): Promise<LinkStatus> {
  const first = fetchable(href);
  if (!first) return { state: 'broken', detail: href.startsWith('http://') ? 'use https://' : 'not a public https:// address' };
  // Redirects are followed by hand so each hop gets the same check as the
  // link: a public page mustn't be able to send the checker somewhere internal.
  const request = async (method: 'HEAD' | 'GET'): Promise<Response | LinkStatus> => {
    const signal = AbortSignal.timeout(LINK_TIMEOUT_MS);
    let url = first;
    for (let hops = 0; ; hops++) {
      const res = await fetch(url, {
        method,
        redirect: 'manual',
        signal,
        headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml,*/*' },
      });
      await res.body?.cancel().catch(() => undefined);
      const location = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
      if (!location) return res;
      if (hops === MAX_REDIRECTS) return { state: 'broken', detail: 'too many redirects' };
      const next = fetchable(location, url);
      if (!next) return { state: 'broken', detail: 'redirects to an address that isn’t public https://' };
      url = next;
    }
  };
  try {
    let res = await request('HEAD');
    // Plenty of sites refuse HEAD; ask properly before calling it broken.
    if (!('state' in res) && (res.status === 403 || res.status === 405 || res.status >= 500)) res = await request('GET');
    if ('state' in res) return res;
    if (res.status < 400) return { state: 'ok', detail: `HTTP ${res.status}` };
    // Bot walls: the page is probably fine for people.
    if (res.status === 401 || res.status === 403 || res.status === 429) return { state: 'unverified', detail: `HTTP ${res.status}` };
    return { state: 'broken', detail: `HTTP ${res.status}` };
  } catch (err) {
    if (err instanceof Error && err.name === 'TimeoutError') return { state: 'unverified', detail: 'timed out' };
    return { state: 'broken', detail: 'no response' };
  }
}

export async function checkExternalLinks(markdown: string): Promise<Map<string, LinkStatus>> {
  const links = externalLinks(markdown).slice(0, 20);
  const results = await Promise.all(links.map(async (href) => [href, await probe(href)] as const));
  return new Map(results);
}

function draftFrom(input: PostInput): SeoDraft {
  const title = input.title.trim();
  return {
    title,
    seoTitle: input.seoTitle?.trim() || `${title} | ${siteConfig.name}`,
    slug: input.slug?.trim() || fileSlug(input.focusKeyphrase, 75),
    metaDescription: input.metaDescription.trim(),
    focusKeyphrase: input.focusKeyphrase.trim(),
    markdown: input.markdown,
    hero: { alt: input.featuredPhoto.alt.trim(), width: null },
  };
}

/** A declined or expired draft's slug is free to use again. */
async function slugTaken(slug: string): Promise<boolean> {
  if (fileSlugs().includes(slug)) return true;
  const snap = await adminDb().collection('newsPosts').doc(slug).get();
  return snap.exists && holdsItsPlace(snap.get('status') as NewsPostStatus, snap.get('submittedAt')?.toMillis?.() ?? 0);
}

export interface CheckOutcome {
  draft: SeoDraft;
  report: SeoReport;
  /** Problems the Yoast-style report doesn't cover: photos and the slug. */
  blockers: string[];
  passes: boolean;
  summary: string;
}

export async function checkPost(input: PostInput): Promise<CheckOutcome> {
  const draft = draftFrom(input);
  const blockers: string[] = [];

  const heroId = input.featuredPhoto.photoId.trim();
  const bodyIds = photoRefs(draft.markdown);
  const allIds = [heroId, ...bodyIds];
  const repeated = allIds.filter((id, i) => allIds.indexOf(id) !== i);
  if (repeated.length) blockers.push(`Each photo can be used once per post; ${[...new Set(repeated)].join(', ')} appears twice.`);

  const unique = [...new Set(allIds)];
  const driveIds = unique.map((id) => parsePhotoId(id)?.driveId).filter((id): id is string => Boolean(id));
  const unreadable = new Map<string, string>();
  const [found, usedSnap, links, others, taken, pages] = await Promise.all([
    Promise.all(
      unique.map((id) =>
        parsePhotoId(id)
          ? getBlogPhoto(id).catch((err: unknown) => {
              unreadable.set(id, err instanceof Error ? err.message : String(err));
              return null;
            })
          : Promise.resolve(null),
      ),
    ),
    driveIds.length
      ? adminDb()
          .collection('newsPosts')
          .where('photoIds', 'array-contains-any', driveIds.slice(0, 30))
          .select('photoIds', 'status', 'submittedAt')
          .get()
      : null,
    checkExternalLinks(draft.markdown),
    everyPost(),
    slugTaken(draft.slug),
    linkablePages(),
  ]);

  const usedBy = new Map<string, string>();
  for (const d of usedSnap?.docs ?? []) {
    if (!holdsItsPlace(d.get('status') as NewsPostStatus, d.get('submittedAt')?.toMillis?.() ?? 0)) continue;
    for (const id of (d.get('photoIds') as string[]) ?? []) usedBy.set(id, d.id);
  }
  const widths = new Map<string, number>();
  unique.forEach((id, i) => {
    const photo = found[i];
    if (!photo) {
      blockers.push(
        unreadable.has(id)
          ? `Couldn’t open photo ${id} in Google Drive (${unreadable.get(id)}). Try again later or pick another.`
          : `Photo ${id} doesn’t exist or the site can’t open it. Use an id from list_blog_photos.`,
      );
      return;
    }
    const driveId = parsePhotoId(id)!.driveId;
    if (usedBy.has(driveId)) blockers.push(`Photo ${id} is already on /news/${usedBy.get(driveId)}. Pick a fresh one.`);
    if (photo.photo.width) widths.set(id, photo.photo.width);
  });
  draft.hero = { alt: draft.hero!.alt, width: widths.get(heroId) ?? null };

  if (taken) blockers.push(`The slug “${draft.slug}” is taken. Choose another (pass \`slug\`).`);

  const report = analyzePost(draft, {
    internalPaths: new Set([...pages.pages, ...pages.posts].map((p) => p.path)),
    otherPosts: others.filter((p) => p.slug !== draft.slug),
    linkStatus: links,
    photoWidths: widths,
  });
  const passes = report.passes && blockers.length === 0;
  const summary = [
    ...(blockers.length ? ['Must fix before submitting:', ...blockers.map((b) => `- [RED] ${b}`), ''] : []),
    summarizeReport(report).replace(/^PASSES: ready to publish\./, passes ? 'PASSES: ready to submit for Travis’s review.' : 'DOES NOT PASS yet.'),
  ].join('\n');
  return { draft, report, blockers, passes, summary };
}

// ---------------------------------------------------------------------------
// Submitting for review, and Travis's verdict
// ---------------------------------------------------------------------------

/** Regenerates every page that lists posts. */
export function revalidateNews(slug: string): void {
  revalidatePath('/news');
  revalidatePath(`/news/${slug}`);
  revalidatePath('/sitemap.xml');
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Whether `token` is the one in the review email for this draft. */
export function reviewTokenMatches(doc: Pick<NewsPostDoc, 'reviewTokenHash'>, token: string | null | undefined): boolean {
  if (!token || !doc.reviewTokenHash) return false;
  const a = Buffer.from(hashToken(token), 'hex');
  const b = Buffer.from(doc.reviewTokenHash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Drafts waiting for Travis whose review email didn't go out, by slug, with
 * Resend's error: onBlogReviewRequested keeps a request it couldn't send,
 * and retryBlogReviewEmails tries it again hourly. One left from an earlier
 * draft under the slug carries another token, so it doesn't count.
 */
export async function unsentReviewEmails(
  posts: Pick<NewsPostDoc, 'slug' | 'status' | 'reviewTokenHash'>[],
): Promise<Map<string, string>> {
  const waiting = posts.filter((p) => p.status === 'pending-review');
  const unsent = new Map<string, string>();
  if (!waiting.length) return unsent;
  const requests = await adminDb().collection('blogReviewRequests').get();
  for (const r of requests.docs) {
    const error = r.get('error') as string | undefined;
    const post = waiting.find((p) => p.slug === ((r.get('slug') as string | undefined) || r.id));
    if (error && post && reviewTokenMatches(post, r.get('token') as string | undefined)) unsent.set(post.slug, error.slice(0, 200));
  }
  return unsent;
}

function allImages(doc: Pick<NewsPostDoc, 'hero' | 'heroCrops' | 'images'>): NewsImage[] {
  return [doc.hero, ...(doc.heroCrops ?? []), ...(doc.images ?? [])].filter(Boolean);
}

/**
 * Copies the draft's photos into Storage, one at a time (each can be a 12 MP
 * original), in a folder of this draft's own, and points each body image at
 * its copy. Body photos are found with marked's lexer, as the check found
 * them, so one with a caption (`![alt](photo:<id> "caption")`), in angle
 * brackets or reference-style is copied like any other, not dropped. If a
 * copy fails, the folder goes too, with the copies made so far.
 */
async function copyPhotos(heroId: string, draft: SeoDraft, folder: string) {
  const names = new Set<string>();
  try {
    const [hero, ...heroCrops] = await importHeroPhoto(heroId, draft.hero!.alt, folder, names);
    const photos: Tokens.Image[] = [];
    walkTokens(new Lexer().lex(draft.markdown), (t) => {
      if (t.type === 'image' && (t as Tokens.Image).href.startsWith('photo:')) photos.push(t as Tokens.Image);
    });
    const ids = photos.map((p) => p.href.slice('photo:'.length));
    const images: NewsImage[] = [];
    let markdown = draft.markdown;
    let from = 0;
    for (const [i, photo] of photos.entries()) {
      // The image's own Markdown, after the ones already swapped.
      const at = markdown.indexOf(photo.raw, from);
      if (at < 0) throw new Error(`Couldn’t place photo ${ids[i]}. Write it on one line as ![alt text](photo:${ids[i]}).`);
      const image = await importBodyPhoto(ids[i]!, photo.text.trim(), folder, names);
      images.push(image);
      const copy = `![${photo.text.replace(/[\\[\]]/g, '\\$&')}](${image.url})`;
      markdown = markdown.slice(0, at) + copy + markdown.slice(at + photo.raw.length);
      from = at + copy.length;
    }
    const photoIds = [heroId, ...ids].map((id) => parsePhotoId(id)!.driveId);
    return { hero: hero!, heroCrops, images, markdown, photoIds };
  } catch (err) {
    await adminStorage()
      .bucket()
      .deleteFiles({ prefix: `${folder}/` })
      .catch((e: unknown) => console.error('Blog: couldn’t delete', folder, e));
    throw err;
  }
}

function audit(action: string, slug: string, actorEmail: string, payload: Record<string, unknown>, via?: 'mcp') {
  return adminDb()
    .collection('auditLog')
    .add({
      action,
      actorEmail,
      ...(via && { via }),
      targetId: `newsPost/${slug}`,
      payload,
      createdAt: FieldValue.serverTimestamp(),
    })
    .catch((err) => console.error('Blog: audit log write failed', err));
}

const ADMIN_EMAIL = () => process.env.NEXT_PUBLIC_ADMIN_EMAIL ?? 'travis';

export type SubmitResult =
  | { ok: true; slug: string; message: string; seoScore: number; readabilityScore: number }
  | { ok: false; reason: string };

/**
 * Saves a draft that passes the check as `pending-review` and asks for the
 * review email (a new `blogReviewRequests` doc, sent by the
 * onBlogReviewRequested Cloud Function, which knows the site's address).
 * The email's link carries a one-time token; only its hash is kept on the
 * post.
 */
export async function submitPost(input: PostInput): Promise<SubmitResult> {
  const cadence = await blogCadence();
  if (!cadence.due) return { ok: false, reason: cadence.status };

  const checked = await checkPost(input);
  if (!checked.passes) return { ok: false, reason: `The post doesn’t pass the check yet.\n\n${checked.summary}` };
  const { draft, report } = checked;

  const folder = `public/news/${draft.slug}/${randomBytes(4).toString('hex')}`;
  const heroId = input.featuredPhoto.photoId.trim();
  const { hero, heroCrops, images, markdown, photoIds } = await copyPhotos(heroId, draft, folder);

  const token = randomBytes(24).toString('base64url');
  const now = Timestamp.now();
  const doc: NewsPostDoc = {
    slug: draft.slug,
    title: draft.title,
    seoTitle: draft.seoTitle,
    description: draft.metaDescription,
    focusKeyphrase: draft.focusKeyphrase,
    markdown,
    hero,
    heroCrops,
    images,
    photoIds,
    status: 'pending-review',
    submittedAt: now,
    publishedAt: null,
    updatedAt: now,
    reviewTokenHash: hashToken(token),
    reviewedAt: null,
    reviewedBy: null,
    reviewNote: null,
    wordCount: report.stats.words,
    seoScore: report.seoScore,
    readabilityScore: report.readabilityScore,
    checks: report.results.map((r) => ({ id: r.id, rating: r.rating })),
    author: 'grokbot',
  };

  const db = adminDb();
  const posts = db.collection('newsPosts');
  const ref = posts.doc(draft.slug);
  const replaced: NewsPostDoc[] = [];
  const refused = await db.runTransaction(async (tx) => {
    // Again inside the transaction, in case two runs raced through the check.
    const rows = (await tx.get(posts.select(...ROW_FIELDS))).docs.map(rowOf);
    const again = cadenceOf(rows, now.toMillis());
    if (!again.due) return again.status;
    const existing = await tx.get(ref);
    if (existing.exists && holdsItsPlace(existing.get('status'), existing.get('submittedAt')?.toMillis?.() ?? 0, now.toMillis())) {
      return `The slug “${draft.slug}” was just taken.`;
    }
    const staleRef = again.stale && again.stale.slug !== draft.slug ? posts.doc(again.stale.slug) : null;
    const stale = staleRef ? await tx.get(staleRef) : null;
    const requests = db.collection('blogReviewRequests');
    const leftover = await tx.get(requests.doc(draft.slug));

    // A declined or expired draft under the same slug is replaced outright;
    // a draft nobody reviewed in time is marked expired.
    if (existing.exists) replaced.push(existing.data() as NewsPostDoc);
    if (staleRef && stale?.exists) {
      replaced.push(stale.data() as NewsPostDoc);
      tx.update(staleRef, { status: 'expired', reviewTokenHash: null, updatedAt: now });
    }
    tx.set(ref, doc);
    // The email goes out when a request is created, and one whose email
    // failed stays behind, so writing over it would send nothing: that case
    // gets a request of its own. Otherwise it's named after the slug, which
    // a function deployed before this change builds the review link from.
    tx.create(leftover.exists ? requests.doc() : requests.doc(draft.slug), {
      slug: draft.slug,
      title: draft.title,
      seoTitle: draft.seoTitle,
      description: draft.metaDescription,
      focusKeyphrase: draft.focusKeyphrase,
      hero: { url: hero.url, alt: hero.alt },
      bodyHtml: emailBodyHtml({ markdown, images }),
      token,
      seoScore: report.seoScore,
      readabilityScore: report.readabilityScore,
      wordCount: report.stats.words,
      createdAt: FieldValue.serverTimestamp(),
    });
    return null;
  });
  if (refused) {
    await deleteStoredImages(allImages(doc));
    return { ok: false, reason: refused };
  }

  await Promise.all(replaced.map((old) => deleteStoredImages(allImages(old))));
  await audit('post.submit', draft.slug, ADMIN_EMAIL(), { title: draft.title, seoScore: report.seoScore, readabilityScore: report.readabilityScore }, 'mcp');
  return {
    ok: true,
    slug: draft.slug,
    message: 'Sent to Travis for review. It goes on the site at /news/' + draft.slug + ' when he approves it. Nothing more to do this run.',
    seoScore: report.seoScore,
    readabilityScore: report.readabilityScore,
  };
}

/**
 * Whether any of a post's photos (`photoIds`, raw Drive ids) is one Trip
 * photos has since withdrawn: Travis deleted it there, a guest asked him to,
 * say. The post keeps its own copy, so it mustn't go on the website, whether
 * it's a draft being approved or a hidden post being put back. Every trip
 * is searched, not just the recent ones the photo listing reads, 30 ids per
 * query (Firestore's limit for `array-contains-any`).
 */
export async function hasWithdrawnPhoto(photoIds: string[]): Promise<boolean> {
  for (let i = 0; i < photoIds.length; i += 30) {
    const snap = await adminDb()
      .collection('tripPhotos')
      .where('withdrawnDriveIds', 'array-contains-any', photoIds.slice(i, i + 30))
      .select()
      .limit(1)
      .get();
    if (!snap.empty) return true;
  }
  return false;
}

const NOT_PENDING: Record<Exclude<NewsPostStatus, 'pending-review'>, string> = {
  published: 'This post is already on the website.',
  hidden: 'This post was approved and later hidden. Put it back from Admin → Blog.',
  declined: 'This draft was already turned down.',
  expired: 'This draft expired: nobody reviewed it within a week, so Grokbot wrote a newer one. Look for that email instead.',
};

export type ReviewResult = { ok: true; slug: string } | { ok: false; error: string };

/**
 * Travis's verdict on a draft. Approving puts it on the site at once;
 * declining keeps it off, removes its photos from Storage, and passes his
 * note back to grokbot in the next brief. `submittedAt` (ms) is the draft
 * he read: a newer one can replace it under the same slug while the page is
 * open, and his verdict mustn't land on a draft he hasn't seen. `method` is
 * for the activity log.
 */
export async function reviewPost(
  slug: string,
  submittedAt: number,
  decision: 'approve' | 'decline',
  by: { email: string; method: 'email link' | 'admin' },
  note?: string,
): Promise<ReviewResult> {
  const db = adminDb();
  const ref = db.collection('newsPosts').doc(slug);
  let doc: NewsPostDoc | null = null;
  const error = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return 'That post no longer exists.';
    doc = snap.data() as NewsPostDoc;
    if (doc.submittedAt.toMillis() !== submittedAt) {
      return 'Grokbot sent a newer draft in place of the one you read, so nothing was changed. Reload the page to read the new one.';
    }
    if (doc.status !== 'pending-review') return NOT_PENDING[doc.status];
    if (decision === 'approve' && (await hasWithdrawnPhoto(doc.photoIds ?? []))) {
      return 'One of this draft’s photos was deleted from Trip photos, so it can’t go on the website. Decline it and Grokbot will write another.';
    }
    const now = Timestamp.now();
    const reviewed = { reviewedAt: now, reviewedBy: by.email, reviewTokenHash: null, updatedAt: now };
    tx.update(
      ref,
      decision === 'approve'
        ? { ...reviewed, status: 'published', publishedAt: now }
        : { ...reviewed, status: 'declined', reviewNote: note?.trim().slice(0, 1000) || null },
    );
    return null;
  });
  if (error) return { ok: false, error };
  const post = doc as unknown as NewsPostDoc;

  if (decision === 'approve') {
    revalidateNews(slug);
  } else {
    await deleteStoredImages(allImages(post));
  }
  await audit(decision === 'approve' ? 'post.approve' : 'post.decline', slug, by.email, {
    title: post.title,
    method: by.method,
    ...(decision === 'decline' && note?.trim() && { note: note.trim().slice(0, 1000) }),
  });
  return { ok: true, slug };
}

import 'server-only';
import { revalidatePath } from 'next/cache';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { marinaNow } from './availability';
import { fileSlug, getBlogPhoto, importBodyPhoto, importHeroPhoto, listBlogPhotos, parsePhotoId } from './blog-photos';
import { faqSections } from './faq';
import { adminDb } from './firebase/admin';
import type { NewsImage, NewsPostDoc } from './firebase/types';
import { fileSlugs, getAllPosts } from './news';
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
import { siteConfig } from './site-config';
import { fetchTourCatalog } from './tours-server';

/*
 * Grokbot's blog: what it needs to write a post (blogBrief), the Yoast-style
 * check (checkPost), and publishing (publishPost), which copies the photos
 * from Drive and writes `newsPosts/{slug}`. The MCP tools in
 * src/lib/mcp/blog-tools.ts are thin wrappers over these.
 *
 * Every other week: a new post is refused until MIN_GAP_DAYS after the last
 * one, so the automation can run weekly (Grok's schedules have no
 * "every two weeks") and still post on alternate weeks.
 */

export const CADENCE_DAYS = 14;
/** A day of slack, so a weekly run that starts a little early still lands. */
export const MIN_GAP_DAYS = CADENCE_DAYS - 1;
const DAY_MS = 24 * 60 * 60 * 1000;

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
// Cadence
// ---------------------------------------------------------------------------

export interface Cadence {
  due: boolean;
  lastPublishedAt: string | null;
  lastSlug: string | null;
  /** When the next post may go up (ISO), or null if one may go up now. */
  nextDueAt: string | null;
}

/** Hidden posts count too, so hiding a post doesn't make the bot post again at once. */
export async function blogCadence(now = Date.now()): Promise<Cadence> {
  const snap = await adminDb().collection('newsPosts').orderBy('publishedAt', 'desc').limit(1).get();
  const last = snap.docs[0];
  if (!last) return { due: true, lastPublishedAt: null, lastSlug: null, nextDueAt: null };
  const at = (last.get('publishedAt') as Timestamp).toMillis();
  const nextDue = at + MIN_GAP_DAYS * DAY_MS;
  return {
    due: now >= nextDue,
    lastPublishedAt: new Date(at).toISOString(),
    lastSlug: last.id,
    nextDueAt: now >= nextDue ? null : new Date(nextDue).toISOString(),
  };
}

function marinaDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: 'America/New_York',
  });
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

/** Every post, hidden ones included, for the duplicate checks. */
async function everyPost(): Promise<SeoContext['otherPosts']> {
  const [published, docs] = await Promise.all([
    getAllPosts(),
    adminDb().collection('newsPosts').select('slug', 'title', 'description', 'focusKeyphrase').get(),
  ]);
  const bySlug = new Map<string, SeoContext['otherPosts'][number]>();
  for (const p of published) {
    bySlug.set(p.slug, { slug: p.slug, title: p.title, description: p.description, focusKeyphrase: p.focusKeyphrase });
  }
  for (const d of docs.docs) {
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
  const { tours } = await fetchTourCatalog();

  return {
    due: cadence.due,
    status: cadence.due
      ? 'A new post is due. Write and publish one.'
      : `Not due yet: the last post went up ${marinaDate(cadence.lastPublishedAt!)} (/news/${cadence.lastSlug}). The next one can go up from ${marinaDate(cadence.nextDueAt!)}. Stop here.`,
    cadence: `One post every ${CADENCE_DAYS} days. Publishing is refused for ${MIN_GAP_DAYS} days after the last post, so running weekly is fine.`,
    howToPublish: [
      '1. Pick a topic not already covered (see existingPosts and topicIdeas) and a focus keyphrase of 2–4 words that people actually search, e.g. “manatee season crystal river”.',
      '2. list_blog_photos, then view_blog_photo on a few. Pick a featured photo (landscape, at least 1200px wide) and 1–4 more for the body.',
      '3. Write the post (rules below). Body photos go in as ![alt text](photo:<id>).',
      '4. check_blog_post. Fix every RED, improve the ORANGEs, and check again until it passes.',
      '5. publish_blog_post with exactly what passed.',
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
      'Plain Markdown only: no HTML, no outside images.',
      `To publish: no RED checks, SEO score ${PUBLISH_MIN_SEO_SCORE}+ and readability ${PUBLISH_MIN_READABILITY_SCORE}+ out of 100.`,
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
    facts: faqSections
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
const USER_AGENT = `Mozilla/5.0 (compatible; CrystalRiverManateeFunLinkCheck/1.0; +${siteConfig.url})`;

/** Only public https hosts are fetched: no IPs, localhost or internal names. */
function fetchable(href: string): URL | null {
  try {
    const url = new URL(href);
    const host = url.hostname;
    if (url.protocol !== 'https:') return null;
    if (host === 'localhost' || /\.(local|internal|localhost)$/.test(host) || /^[\d.]+$/.test(host) || host.includes(':')) return null;
    return url;
  } catch {
    return null;
  }
}

async function probe(href: string): Promise<LinkStatus> {
  const url = fetchable(href);
  if (!url) return { state: 'broken', detail: href.startsWith('http://') ? 'use https://' : 'not a public https:// address' };
  const request = async (method: 'HEAD' | 'GET') => {
    const res = await fetch(url, {
      method,
      redirect: 'follow',
      signal: AbortSignal.timeout(LINK_TIMEOUT_MS),
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml,*/*' },
    });
    await res.body?.cancel().catch(() => undefined);
    return res;
  };
  try {
    let res = await request('HEAD');
    // Plenty of sites refuse HEAD; ask properly before calling it broken.
    if (res.status === 403 || res.status === 405 || res.status >= 500) res = await request('GET');
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

async function slugTaken(slug: string): Promise<boolean> {
  if (fileSlugs().includes(slug)) return true;
  return (await adminDb().collection('newsPosts').doc(slug).get()).exists;
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
      ? adminDb().collection('newsPosts').where('photoIds', 'array-contains-any', driveIds.slice(0, 30)).select('photoIds').get()
      : null,
    checkExternalLinks(draft.markdown),
    everyPost(),
    slugTaken(draft.slug),
    linkablePages(),
  ]);

  const usedBy = new Map<string, string>();
  for (const d of usedSnap?.docs ?? []) {
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
    ...(blockers.length ? ['Must fix before publishing:', ...blockers.map((b) => `- [RED] ${b}`), ''] : []),
    summarizeReport(report).replace(/^PASSES: ready to publish\./, passes ? 'PASSES: ready to publish.' : 'DOES NOT PASS yet.'),
  ].join('\n');
  return { draft, report, blockers, passes, summary };
}

// ---------------------------------------------------------------------------
// Publishing
// ---------------------------------------------------------------------------

/** Regenerates every page that lists posts. */
export function revalidateNews(slug: string): void {
  revalidatePath('/news');
  revalidatePath(`/news/${slug}`);
  revalidatePath('/sitemap.xml');
}

export type PublishResult =
  | { ok: true; url: string; slug: string; seoScore: number; readabilityScore: number }
  | { ok: false; reason: string };

export async function publishPost(input: PostInput): Promise<PublishResult> {
  const cadence = await blogCadence();
  if (!cadence.due) {
    return {
      ok: false,
      reason: `Not due yet: the last post went up ${marinaDate(cadence.lastPublishedAt!)}. The next one can go up from ${marinaDate(cadence.nextDueAt!)}.`,
    };
  }

  const checked = await checkPost(input);
  if (!checked.passes) return { ok: false, reason: `The post doesn’t pass the check yet.\n\n${checked.summary}` };
  const { draft, report } = checked;

  // Copy the photos into Storage, one at a time (each can be a 12 MP original).
  const names = new Set<string>();
  const heroId = input.featuredPhoto.photoId.trim();
  const [hero, ...heroCrops] = await importHeroPhoto(heroId, draft.hero!.alt, draft.slug, names);
  const images: NewsImage[] = [];
  let markdown = draft.markdown;
  for (const match of [...draft.markdown.matchAll(/!\[([^\]]*)\]\(photo:([^)\s]+)\)/g)]) {
    const [whole, alt, id] = match as unknown as [string, string, string];
    const image = await importBodyPhoto(id, alt.trim(), draft.slug, names);
    images.push(image);
    markdown = markdown.replace(whole, () => `![${alt}](${image.url})`);
  }

  const now = Timestamp.now();
  const doc: NewsPostDoc = {
    slug: draft.slug,
    title: draft.title,
    seoTitle: draft.seoTitle,
    description: draft.metaDescription,
    focusKeyphrase: draft.focusKeyphrase,
    markdown,
    hero: hero!,
    heroCrops,
    images,
    photoIds: [heroId, ...photoRefs(draft.markdown)].map((id) => parsePhotoId(id)!.driveId),
    status: 'published',
    publishedAt: now,
    updatedAt: now,
    wordCount: report.stats.words,
    seoScore: report.seoScore,
    readabilityScore: report.readabilityScore,
    checks: report.results.map((r) => ({ id: r.id, rating: r.rating })),
    author: 'grokbot',
  };

  const db = adminDb();
  const ref = db.collection('newsPosts').doc(draft.slug);
  const refused = await db.runTransaction(async (tx) => {
    // Again inside the transaction, in case two runs raced through the check.
    const latest = await tx.get(db.collection('newsPosts').orderBy('publishedAt', 'desc').limit(1));
    const lastAt = latest.docs[0]?.get('publishedAt') as Timestamp | undefined;
    if (lastAt && now.toMillis() - lastAt.toMillis() < MIN_GAP_DAYS * DAY_MS) return 'Another post was just published.';
    if ((await tx.get(ref)).exists) return `The slug “${draft.slug}” was just taken.`;
    tx.create(ref, doc);
    return null;
  });
  if (refused) return { ok: false, reason: refused };

  const url = `${siteConfig.url}/news/${draft.slug}`;
  await db
    .collection('auditLog')
    .add({
      action: 'post.publish',
      actorEmail: process.env.NEXT_PUBLIC_ADMIN_EMAIL ?? 'grokbot',
      via: 'mcp',
      targetId: `newsPost/${draft.slug}`,
      payload: { title: draft.title, url, seoScore: report.seoScore, readabilityScore: report.readabilityScore },
      createdAt: FieldValue.serverTimestamp(),
    })
    .catch((err) => console.error('Blog: audit log write failed', err));
  revalidateNews(draft.slug);

  return { ok: true, url, slug: draft.slug, seoScore: report.seoScore, readabilityScore: report.readabilityScore };
}

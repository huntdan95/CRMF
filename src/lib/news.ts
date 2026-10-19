import 'server-only';
import fs from 'node:fs';
import path from 'node:path';
import { cache } from 'react';
import { Marked } from 'marked';
import type { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from './firebase/admin';
import type { NewsImage, NewsPostDoc } from './firebase/types';

/**
 * News posts, from two places:
 *
 *  - Markdown files in `content/news/<slug>.md` (the posts migrated from
 *    WordPress, and anything added by hand). Frontmatter is a flat list of
 *    `key: "value"` lines. `#` lines are comments (handy for TODOs that
 *    shouldn't ship in the HTML):
 *
 *      ---
 *      title: "Post title"
 *      date: "2024-01-04T01:01:03Z"
 *      description: "Meta description, ~150 characters."
 *      image: "/images/news/photo.jpg"      # optional; also the social card
 *      imageAlt: "What the photo shows"     # required when image is set
 *      ---
 *
 *  - `newsPosts/{slug}` in Firestore: posts grokbot submits through the
 *    MCP endpoint (src/lib/blog-publish.ts). Only `published` ones (Travis
 *    approved them, and hasn't hidden them since) appear on the site.
 *
 * The slug is the filename or doc id, so it is also the URL. Posts migrated
 * from the old WordPress site keep their exact slugs — don't rename those
 * files.
 *
 * The /news pages regenerate every minute (the marketing layout's
 * `revalidate`), and at once when grokbot publishes or Travis hides a post
 * (revalidateNews in src/lib/blog-publish.ts).
 */

export interface NewsPost {
  slug: string;
  title: string;
  /** The whole <title> when the post sets its own; otherwise the site template applies. */
  seoTitle: string | null;
  /** ISO 8601 publish date. */
  date: string;
  /** ISO 8601 last change. */
  modified: string;
  description: string;
  /** Social card and index-card photo. */
  image: string | null;
  imageAlt: string;
  /** Shown above the post (grokbot posts; migrated posts have theirs in the body). */
  hero: NewsImage | null;
  /** Every crop of the featured photo, for the BlogPosting markup. */
  heroCrops: NewsImage[];
  focusKeyphrase: string | null;
  wordCount: number;
  source: 'file' | 'grokbot';
  /** Rendered body HTML. */
  html: string;
}

const NEWS_DIR = path.join(process.cwd(), 'content', 'news');

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const markdown = new Marked({
  renderer: {
    // External links open in a new tab, like the rest of the site.
    link({ href, title, tokens }) {
      const text = this.parser.parseInline(tokens);
      const titleAttr = title ? ` title="${title}"` : '';
      const external = /^https?:\/\//.test(href);
      const rel = external ? ' target="_blank" rel="noopener noreferrer"' : '';
      return `<a href="${href}"${titleAttr}${rel}>${text}</a>`;
    },
    image({ href, title, text }) {
      const titleAttr = title ? ` title="${title}"` : '';
      return `<img src="${href}" alt="${text}"${titleAttr} loading="lazy" decoding="async">`;
    },
  },
});

/**
 * Responsive sizes through Next's image optimizer, the same URLs next/image
 * makes. Firebase Storage is allowed in next.config.ts `images`.
 */
const SRCSET_WIDTHS = [640, 1080, 1920];

function optimized(url: string, width: number): string {
  return `/_next/image?url=${encodeURIComponent(url)}&w=${width}&q=75`;
}

/**
 * Grokbot's Markdown comes from a model, so it renders with no raw HTML, only
 * http(s) and site-relative links, and only the post's own Storage photos.
 * The check in src/lib/seo-check.ts refuses those before publishing; this
 * is the second fence.
 */
function botMarkdown(images: NewsImage[]): Marked {
  const byUrl = new Map(images.map((i) => [i.url, i]));
  return new Marked({
    renderer: {
      html({ text }) {
        return escapeAttr(text);
      },
      link({ href, tokens }) {
        const text = this.parser.parseInline(tokens);
        if (/^https?:\/\//i.test(href)) {
          return `<a href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer">${text}</a>`;
        }
        if (/^\/(?!\/)|^#/.test(href)) return `<a href="${escapeAttr(href)}">${text}</a>`;
        return text;
      },
      image({ href }) {
        const img = byUrl.get(href);
        if (!img) return '';
        const srcset = SRCSET_WIDTHS.map((w) => `${optimized(img.url, w)} ${w}w`).join(', ');
        return (
          `<img src="${optimized(img.url, 1080)}" srcset="${srcset}" sizes="(min-width: 768px) 720px, 100vw"` +
          ` width="${img.width}" height="${img.height}" alt="${escapeAttr(img.alt)}" loading="lazy" decoding="async">`
        );
      },
    },
  });
}

function parseFrontmatter(raw: string, file: string) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
  if (!match) throw new Error(`${file}: missing frontmatter`);
  const data: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const colon = trimmed.indexOf(':');
    if (colon < 0) throw new Error(`${file}: bad frontmatter line "${trimmed}"`);
    const key = trimmed.slice(0, colon).trim();
    let value = trimmed.slice(colon + 1).trim();
    if (value.startsWith('"')) value = JSON.parse(value) as string;
    data[key] = value;
  }
  return { data, body: raw.slice(match[0].length) };
}

function countWords(md: string): number {
  return md.replace(/!\[[^\]]*\]\([^)]*\)|<[^>]+>/g, ' ').split(/\s+/).filter((w) => /[a-z0-9]/i.test(w)).length;
}

function readFilePost(slug: string): NewsPost {
  const file = path.join(NEWS_DIR, `${slug}.md`);
  const { data, body } = parseFrontmatter(fs.readFileSync(file, 'utf8'), file);
  for (const key of ['title', 'date', 'description'] as const) {
    if (!data[key]) throw new Error(`${file}: frontmatter is missing "${key}"`);
  }
  if (Number.isNaN(Date.parse(data.date))) {
    throw new Error(`${file}: "${data.date}" is not a valid date`);
  }
  if (data.image && !data.imageAlt) {
    throw new Error(`${file}: "image" needs an "imageAlt"`);
  }
  return {
    slug,
    title: data.title,
    seoTitle: null,
    date: data.date,
    modified: data.date,
    description: data.description,
    image: data.image || null,
    imageAlt: data.imageAlt ?? '',
    hero: null,
    heroCrops: [],
    focusKeyphrase: data.focusKeyphrase || null,
    wordCount: countWords(body),
    source: 'file',
    html: markdown.parse(body, { async: false }),
  };
}

function fromDoc(doc: NewsPostDoc): NewsPost {
  const iso = (t: Timestamp) => t.toDate().toISOString();
  // A draft waiting for review is dated by when it was sent.
  const date = doc.publishedAt ?? doc.submittedAt;
  return {
    slug: doc.slug,
    title: doc.title,
    seoTitle: doc.seoTitle,
    date: iso(date),
    modified: iso(doc.publishedAt ? (doc.updatedAt ?? date) : date),
    description: doc.description,
    image: doc.hero.url,
    imageAlt: doc.hero.alt,
    hero: doc.hero,
    heroCrops: [doc.hero, ...(doc.heroCrops ?? [])],
    focusKeyphrase: doc.focusKeyphrase,
    wordCount: doc.wordCount,
    source: 'grokbot',
    html: botMarkdown(doc.images ?? []).parse(doc.markdown, { async: false }),
  };
}

function filePosts(): NewsPost[] {
  return fs
    .readdirSync(NEWS_DIR)
    .filter((f) => f.endsWith('.md'))
    .map((f) => readFilePost(f.replace(/\.md$/, '')));
}

/**
 * Published grokbot posts. At build time Firestore may be out of reach
 * (CI has no credentials), so the build goes ahead with the Markdown posts
 * and the next regeneration adds the rest. At runtime a failure throws, so
 * Next keeps serving the last good page instead of dropping posts.
 */
async function firestorePosts(): Promise<NewsPost[]> {
  try {
    const snap = await adminDb().collection('newsPosts').where('status', '==', 'published').get();
    return snap.docs.map((d) => fromDoc(d.data() as NewsPostDoc));
  } catch (err) {
    if (process.env.NEXT_PHASE === 'phase-production-build') {
      console.warn('News: Firestore unreachable during the build; using content/news only.', err);
      return [];
    }
    throw err;
  }
}

/** All published posts, newest first. */
export const getAllPosts = cache(async (): Promise<NewsPost[]> => {
  const posts = [...filePosts(), ...(await firestorePosts())];
  return posts.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
});

export async function getPost(slug: string): Promise<NewsPost | undefined> {
  return (await getAllPosts()).find((p) => p.slug === slug);
}

/**
 * A grokbot post in any state, rendered as it will look on the site: what
 * the review page shows Travis before he approves it.
 */
export async function getPostDoc(slug: string): Promise<{ post: NewsPost; doc: NewsPostDoc } | null> {
  const snap = await adminDb().collection('newsPosts').doc(slug).get();
  if (!snap.exists) return null;
  const doc = snap.data() as NewsPostDoc;
  return { post: fromDoc(doc), doc };
}

/**
 * The body for the review email: the same fences as the site, with photos
 * as plain full-width images (email clients don't do srcset). Site links
 * stay relative; the email function puts the site's address in front.
 */
export function emailBodyHtml(doc: Pick<NewsPostDoc, 'markdown' | 'images'>): string {
  const byUrl = new Map((doc.images ?? []).map((i) => [i.url, i]));
  const img = 'display:block;width:100%;max-width:560px;height:auto;border-radius:8px;margin:20px 0;';
  return new Marked({
    renderer: {
      html({ text }) {
        return escapeAttr(text);
      },
      link({ href, tokens }) {
        const text = this.parser.parseInline(tokens);
        if (/^https?:\/\//i.test(href) || /^\/(?!\/)/.test(href)) {
          return `<a href="${escapeAttr(href)}" style="color:#1B6FA8;">${text}</a>`;
        }
        return text;
      },
      image({ href }) {
        const image = byUrl.get(href);
        return image ? `<img src="${escapeAttr(image.url)}" alt="${escapeAttr(image.alt)}" width="560" style="${img}">` : '';
      },
    },
  }).parse(doc.markdown, { async: false });
}

/** Slugs of the Markdown posts, which grokbot can never take. */
export function fileSlugs(): string[] {
  return fs
    .readdirSync(NEWS_DIR)
    .filter((f) => f.endsWith('.md'))
    .map((f) => f.replace(/\.md$/, ''));
}

/** Absolute URL for a post image (Markdown posts use site paths). */
export function absoluteImageUrl(src: string, siteUrl: string): string {
  return /^https?:\/\//.test(src) ? src : `${siteUrl}${src}`;
}

/** "December 19, 2023" — in Florida time, where the posts were written. */
export function formatPostDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'America/New_York',
  });
}

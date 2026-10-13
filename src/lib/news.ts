import 'server-only';
import fs from 'node:fs';
import path from 'node:path';
import { Marked } from 'marked';

/**
 * News posts, stored as Markdown in `content/news/<slug>.md`.
 *
 * Frontmatter is a flat list of `key: "value"` lines. `#` lines are
 * comments (handy for TODOs that shouldn't ship in the HTML):
 *
 *   ---
 *   title: "Post title"
 *   date: "2024-01-04T01:01:03Z"
 *   description: "Meta description, ~150 characters."
 *   image: "/images/news/photo.jpg"      # optional; also the social card
 *   imageAlt: "What the photo shows"     # required when image is set
 *   ---
 *
 * The slug is the filename, so it is also the URL. Posts migrated from the
 * old WordPress site keep their exact slugs — don't rename those files.
 *
 * Every page that reads posts is statically generated, so this only runs
 * at build time.
 */

export interface NewsPost {
  slug: string;
  title: string;
  /** ISO 8601 publish date. */
  date: string;
  description: string;
  image: string | null;
  imageAlt: string;
  /** Rendered body HTML. */
  html: string;
}

const NEWS_DIR = path.join(process.cwd(), 'content', 'news');

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

function readPost(slug: string): NewsPost {
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
    date: data.date,
    description: data.description,
    image: data.image || null,
    imageAlt: data.imageAlt ?? '',
    html: markdown.parse(body, { async: false }),
  };
}

/** All posts, newest first. */
export function getAllPosts(): NewsPost[] {
  return fs
    .readdirSync(NEWS_DIR)
    .filter((f) => f.endsWith('.md'))
    .map((f) => readPost(f.replace(/\.md$/, '')))
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
}

export function getPost(slug: string): NewsPost | undefined {
  return getAllPosts().find((p) => p.slug === slug);
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

import type { NewsPostStatus } from './firebase/types';

/*
 * The timing rules for grokbot's blog, shared by publishing, the photo
 * picker and Admin → Blog, and which of a post's stored images are copies
 * of which photo.
 */

/** One post every two weeks... */
export const CADENCE_DAYS = 14;
/** ...counted from when it was submitted, with a day of slack for a weekly run that starts early. */
export const MIN_GAP_DAYS = CADENCE_DAYS - 1;
/** How long a draft waits for Travis before the next run replaces it. */
export const REVIEW_WINDOW_DAYS = 7;
export const DAY_MS = 24 * 60 * 60 * 1000;
/**
 * The review window, with half a day of slack like MIN_GAP_DAYS: a draft is
 * submitted a few minutes into a weekly run, so the next run, a week later,
 * would otherwise find it minutes short of expiring and wait another week.
 */
const REVIEW_WINDOW_MS = REVIEW_WINDOW_DAYS * DAY_MS - DAY_MS / 2;

/**
 * Whether a post still holds its slug, keyphrase and photos: anything
 * Travis approved (live, or hidden since), or a draft he can still
 * approve. Declined and expired drafts free theirs, and so does a draft
 * past the review window, which the next submission expires.
 */
export function holdsItsPlace(status: NewsPostStatus, submittedAtMs: number, now = Date.now()): boolean {
  if (status === 'published' || status === 'hidden') return true;
  return status === 'pending-review' && now - submittedAtMs < REVIEW_WINDOW_MS;
}

/** A post's photos and its own stored copies of them (NewsPostDoc's fields). */
export interface StoredPhotos {
  photoIds?: string[];
  hero?: { storagePath: string } | null;
  heroCrops?: Array<{ storagePath: string }>;
  images?: Array<{ storagePath: string }>;
}

/**
 * The Storage paths of a post's own copies of the given Drive photos.
 * `photoIds` lists the hero's photo first, then the body photos in order
 * (submitPost), so the first is the hero and its crops and each of the
 * rest is the body image in the same place. A post whose lists don't line
 * up that way gives every copy it has, rather than miss one. The functions
 * have the same (functions/src/lib/trip-photos.ts).
 */
export function storedCopiesOf(post: StoredPhotos, driveIds: Iterable<string>): string[] {
  const wanted = new Set(driveIds);
  const ids = post.photoIds ?? [];
  const hero = [post.hero, ...(post.heroCrops ?? [])].flatMap((i) => (i ? [i.storagePath] : []));
  const body = (post.images ?? []).map((i) => i.storagePath);
  const paths =
    ids.length !== body.length + 1
      ? ids.some((id) => wanted.has(id))
        ? [...hero, ...body]
        : []
      : ids.flatMap((id, i) => (!wanted.has(id) ? [] : i === 0 ? hero : [body[i - 1]!]));
  return [...new Set(paths)];
}

/** What the cadence needs to know about each grokbot post. */
export interface PostRow {
  slug: string;
  title: string;
  status: NewsPostStatus;
  submittedAt: number;
  reviewedAt: number | null;
  reviewNote: string | null;
}

export interface Cadence {
  due: boolean;
  /** One sentence for grokbot: what to do now. */
  status: string;
  /** The draft waiting for Travis, if any. */
  pending: { slug: string; title: string; submittedAt: string } | null;
  /** A draft nobody reviewed in time; the next submission expires it. */
  stale: { slug: string; title: string } | null;
  /** When the next draft may be submitted, if not now. */
  nextDueAt: string | null;
  /** Drafts Travis turned down since the last post he approved (three at most), newest first, with what he said. */
  declined: { title: string; note: string | null; at: string }[];
}

/** "Tuesday, October 20", in marina time. */
export function marinaDate(ms: number): string {
  return new Date(ms).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: 'America/New_York',
  });
}

/**
 * Whether grokbot should write a post now. Nothing while a draft waits for
 * Travis; otherwise one every two weeks, counted from when the last
 * approved post was submitted, so a slow approval doesn't push the next
 * one back. Declined and expired drafts don't count: the next run tries
 * again.
 */
export function cadenceOf(rows: PostRow[], now = Date.now()): Cadence {
  const iso = (ms: number) => new Date(ms).toISOString();
  const pendingRows = rows.filter((r) => r.status === 'pending-review').sort((a, b) => b.submittedAt - a.submittedAt);
  const waiting = pendingRows.find((r) => now - r.submittedAt < REVIEW_WINDOW_MS);
  const staleRow = pendingRows.find((r) => now - r.submittedAt >= REVIEW_WINDOW_MS);
  const approved = rows.filter((r) => r.status === 'published' || r.status === 'hidden').map((r) => r.submittedAt);
  const lastApproved = approved.length ? Math.max(...approved) : 0;
  const nextDue = lastApproved ? lastApproved + MIN_GAP_DAYS * DAY_MS : 0;
  // Only feedback since the last post he approved is still news: the posts
  // he approved since dealt with anything older, and an old note left in the
  // brief would steer every post after it.
  const declined = rows
    .filter((r) => r.status === 'declined' && (r.reviewedAt ?? r.submittedAt) > lastApproved)
    .sort((a, b) => (b.reviewedAt ?? 0) - (a.reviewedAt ?? 0))
    .slice(0, 3)
    .map((r) => ({ title: r.title, note: r.reviewNote, at: iso(r.reviewedAt ?? r.submittedAt) }));
  const latestNo = declined[0] ?? null;
  const base = { declined, stale: null, pending: null, nextDueAt: null };

  if (waiting) {
    return {
      ...base,
      due: false,
      status: `Waiting for Travis to review “${waiting.title}” (sent ${marinaDate(waiting.submittedAt)}). Stop here.`,
      pending: { slug: waiting.slug, title: waiting.title, submittedAt: iso(waiting.submittedAt) },
    };
  }
  if (now < nextDue) {
    return {
      ...base,
      due: false,
      status: `Not due yet. The next post is due from ${marinaDate(nextDue)}. Stop here.`,
      nextDueAt: iso(nextDue),
    };
  }
  const notes = [
    staleRow && `Travis didn’t review “${staleRow.title}” within ${REVIEW_WINDOW_DAYS} days; your new post replaces it.`,
    latestNo &&
      `Travis turned down “${latestNo.title}”${latestNo.note ? `, saying: “${latestNo.note.replace(/[.!\s]+$/, '')}.” Take that into account.` : '.'}`,
  ].filter(Boolean);
  return {
    ...base,
    due: true,
    status: ['A new post is due. Write one and submit it for Travis to review.', ...notes].join(' '),
    stale: staleRow ? { slug: staleRow.slug, title: staleRow.title } : null,
  };
}

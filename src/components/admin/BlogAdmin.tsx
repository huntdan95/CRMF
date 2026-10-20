'use client';

import { useState, useTransition } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { setPostStatus } from '@/app/admin/(protected)/blog/actions';
import { clsx } from '@/lib/clsx';
import type { NewsPostStatus } from '@/lib/firebase/types';
import { Badge, PanelFooter, buttonClass, panelClass, type BadgeTone } from './ui';

export interface BlogRow {
  slug: string;
  title: string;
  description: string;
  focusKeyphrase: string;
  submittedAt: string;
  publishedAt: string | null;
  status: NewsPostStatus;
  reviewNote: string | null;
  seoScore: number;
  readabilityScore: number;
  wordCount: number;
  thumbnail: string;
  thumbnailAlt: string;
  /** A draft waiting for review whose email didn't go out: why (it's retried hourly). */
  reviewEmailError: string | null;
}

const STATUS: Record<NewsPostStatus, { label: string; tone: BadgeTone }> = {
  'pending-review': { label: 'Waiting for your review', tone: 'buoy' },
  published: { label: 'On the website', tone: 'spring' },
  hidden: { label: 'Taken down', tone: 'muted' },
  declined: { label: 'Turned down', tone: 'muted' },
  expired: { label: 'Not reviewed in time', tone: 'muted' },
};

function scoreTone(score: number): BadgeTone {
  return score >= 80 ? 'spring' : score >= 70 ? 'sand' : 'buoy';
}

function day(iso: string, weekday = false): string {
  return new Date(iso).toLocaleDateString('en-US', {
    ...(weekday && { weekday: 'long' }),
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'America/New_York',
  });
}

export function BlogAdmin({
  rows,
  nextDueAt,
  waitingForReview,
  shareWith,
  connectorUrl,
}: {
  rows: BlogRow[];
  nextDueAt: string | null;
  /** A draft waits for Travis's review, so grokbot holds off. */
  waitingForReview: boolean;
  shareWith: string | null;
  /** /api/mcp/blog with its key; null while MCP_TOKEN isn't set. */
  connectorUrl: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const emailUnsent = rows.some((r) => r.status === 'pending-review' && r.reviewEmailError);

  async function change(slug: string, status: 'published' | 'hidden') {
    setBusy(slug);
    setError(null);
    try {
      const result = await setPostStatus(slug, status);
      if (!result.ok) setError(result.error);
    } catch {
      // Lost the connection or the server failed partway: the refresh
      // below shows whether the post changed.
      setError('That didn’t go through. Check your signal and try again.');
    } finally {
      startTransition(() => router.refresh());
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      <div className={clsx(panelClass, 'p-5 text-[0.9375rem] leading-relaxed')}>
        <p>
          {waitingForReview ? (
            <>
              A draft is waiting for your review ({emailUnsent ? 'below: its email didn’t go out' : 'below, and in your email'}).
              Grokbot won’t write another until you’ve looked at it.
            </>
          ) : nextDueAt ? (
            <>
              Next post: from <strong>{day(nextDueAt, true)}</strong>.
            </>
          ) : (
            <>A post is due. Grokbot writes one on its next run and emails it to you to approve.</>
          )}
        </p>
        {shareWith && (
          <p className="mt-2 text-sm text-[var(--color-ink-soft)]">
            Grokbot uses the GoPro photos the crew upload, plus any Google Drive folder you share
            with <strong className="break-all text-[var(--color-ink)]">{shareWith}</strong> (as a
            Viewer). Share a folder of your best manatee shots to give it more to choose from.
          </p>
        )}
        {connectorUrl && (
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer font-semibold text-[var(--color-spring)]">
              Grokbot connector address
            </summary>
            <p className="mt-2 text-[var(--color-ink-soft)]">
              In Grok, add this as a custom connector. It only lets Grok write blog posts, not
              touch bookings. Keep it private, like a password.
            </p>
            <input
              readOnly
              value={connectorUrl}
              onFocus={(e) => e.currentTarget.select()}
              aria-label="Grokbot connector address"
              className="mt-2 w-full rounded-[10px] border border-[var(--color-line-strong)] bg-[var(--color-paper)] px-3 py-2 font-mono text-xs"
            />
          </details>
        )}
      </div>

      {error && (
        <div className="rounded-2xl bg-[var(--color-coral)]/10 border border-[var(--color-coral)]/30 p-3 text-sm">
          {error}
        </div>
      )}

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[var(--color-line-strong)] bg-white/50 p-8 text-center text-sm text-[var(--color-ink-soft)]">
          No posts from grokbot yet. The posts copied over from the old website are still on the
          News page.
        </div>
      ) : (
        <div className="space-y-4">
          {rows.map((p) => (
            <article key={p.slug} className={clsx(panelClass, 'overflow-hidden')}>
              <div className="flex flex-col gap-4 p-5 sm:flex-row">
                {/* Turned-down and expired drafts' photos are deleted. */}
                {(p.status === 'pending-review' || p.status === 'published' || p.status === 'hidden') && (
                  <Image
                    src={p.thumbnail}
                    alt={p.thumbnailAlt}
                    width={192}
                    height={108}
                    className={clsx('h-[108px] w-[192px] shrink-0 rounded-xl object-cover', p.status === 'hidden' && 'opacity-50')}
                  />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={STATUS[p.status].tone}>{STATUS[p.status].label}</Badge>
                    <span className="text-xs text-[var(--color-ink-soft)] tabular-nums">
                      {p.publishedAt ? `Published ${day(p.publishedAt)}` : `Sent ${day(p.submittedAt)}`}
                    </span>
                  </div>
                  <h2 className="mt-2 text-lg font-bold leading-snug">{p.title}</h2>
                  <p className="mt-1 text-sm text-[var(--color-ink-soft)]">{p.description}</p>
                  {p.status === 'pending-review' && p.reviewEmailError && (
                    <p className="mt-2 text-sm text-[var(--color-coral-dark)]">
                      The email with this draft didn’t go out ({p.reviewEmailError}). The site tries again every
                      hour; you can review it here meanwhile.
                    </p>
                  )}
                  {p.status === 'declined' && p.reviewNote && (
                    <p className="mt-2 text-sm">
                      <span className="font-semibold">Your note:</span> {p.reviewNote}
                    </p>
                  )}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Badge tone={scoreTone(p.seoScore)}>SEO {p.seoScore}</Badge>
                    <Badge tone={scoreTone(p.readabilityScore)}>Readability {p.readabilityScore}</Badge>
                    <Badge tone="muted">{p.wordCount} words</Badge>
                    <Badge tone="muted">Keyphrase: {p.focusKeyphrase}</Badge>
                  </div>
                </div>
              </div>
              <PanelFooter>
                {p.status === 'pending-review' && (
                  <a href={`/blog-review/${p.slug}`} className={buttonClass('primary', 'sm')}>
                    Review and approve
                  </a>
                )}
                {p.status === 'published' && (
                  <a href={`/news/${p.slug}`} target="_blank" rel="noreferrer" className={buttonClass('secondary', 'sm')}>
                    View post
                  </a>
                )}
                {p.status === 'published' && (
                  <button
                    type="button"
                    onClick={() => change(p.slug, 'hidden')}
                    disabled={busy === p.slug}
                    className={buttonClass('danger', 'sm')}
                  >
                    Take off the website
                  </button>
                )}
                {p.status === 'hidden' && (
                  <button
                    type="button"
                    onClick={() => change(p.slug, 'published')}
                    disabled={busy === p.slug}
                    className={buttonClass('secondary', 'sm')}
                  >
                    Put back on the website
                  </button>
                )}
              </PanelFooter>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

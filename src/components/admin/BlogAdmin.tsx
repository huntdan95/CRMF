'use client';

import { useState, useTransition } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { setPostStatus } from '@/app/admin/(protected)/blog/actions';
import { clsx } from '@/lib/clsx';
import { Badge, PanelFooter, buttonClass, panelClass, type BadgeTone } from './ui';

export interface BlogRow {
  slug: string;
  title: string;
  description: string;
  focusKeyphrase: string;
  publishedAt: string;
  status: 'published' | 'hidden';
  seoScore: number;
  readabilityScore: number;
  wordCount: number;
  thumbnail: string;
  thumbnailAlt: string;
}

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
  shareWith,
  connectorUrl,
}: {
  rows: BlogRow[];
  nextDueAt: string | null;
  shareWith: string | null;
  /** /api/mcp/blog with its key; null while MCP_TOKEN isn't set. */
  connectorUrl: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function change(slug: string, status: BlogRow['status']) {
    setBusy(slug);
    setError(null);
    const result = await setPostStatus(slug, status);
    if (!result.ok) setError(result.error);
    startTransition(() => router.refresh());
    setBusy(null);
  }

  return (
    <div className="space-y-5">
      <div className={clsx(panelClass, 'p-5 text-[0.9375rem] leading-relaxed')}>
        <p>
          {nextDueAt ? (
            <>
              Next post: from <strong>{day(nextDueAt, true)}</strong>.
            </>
          ) : (
            <>A post is due. Grokbot writes one on its next run.</>
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
                <Image
                  src={p.thumbnail}
                  alt={p.thumbnailAlt}
                  width={192}
                  height={108}
                  className={clsx('h-[108px] w-[192px] shrink-0 rounded-xl object-cover', p.status === 'hidden' && 'opacity-50')}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={p.status === 'published' ? 'spring' : 'muted'}>
                      {p.status === 'published' ? 'On the website' : 'Hidden'}
                    </Badge>
                    <span className="text-xs text-[var(--color-ink-soft)] tabular-nums">{day(p.publishedAt)}</span>
                  </div>
                  <h2 className="mt-2 text-lg font-bold leading-snug">{p.title}</h2>
                  <p className="mt-1 text-sm text-[var(--color-ink-soft)]">{p.description}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Badge tone={scoreTone(p.seoScore)}>SEO {p.seoScore}</Badge>
                    <Badge tone={scoreTone(p.readabilityScore)}>Readability {p.readabilityScore}</Badge>
                    <Badge tone="muted">{p.wordCount} words</Badge>
                    <Badge tone="muted">Keyphrase: {p.focusKeyphrase}</Badge>
                  </div>
                </div>
              </div>
              <PanelFooter>
                {p.status === 'published' && (
                  <a href={`/news/${p.slug}`} target="_blank" rel="noreferrer" className={buttonClass('secondary', 'sm')}>
                    View post
                  </a>
                )}
                {p.status === 'published' ? (
                  <button
                    type="button"
                    onClick={() => change(p.slug, 'hidden')}
                    disabled={busy === p.slug}
                    className={buttonClass('danger', 'sm')}
                  >
                    Hide from the website
                  </button>
                ) : (
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

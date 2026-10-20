'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { reviewDraft } from './actions';

/**
 * Approve & publish, or Don't publish with a note for grokbot.
 * `submittedAt` (ms) is the draft on the page, so a verdict never lands on
 * a newer one that replaced it.
 */
export function ReviewActions({ slug, token, submittedAt }: { slug: string; token: string | null; submittedAt: number }) {
  const [busy, setBusy] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<'approve' | 'decline' | null>(null);

  async function decide(decision: 'approve' | 'decline') {
    setBusy(true);
    setError(null);
    try {
      const result = await reviewDraft(slug, token, submittedAt, decision, decision === 'decline' ? note : undefined);
      if (result.ok) setDone(decision);
      else setError(result.error);
    } catch {
      // Lost the signal, or the server failed part way: it may or may not
      // have gone through, and a reload shows which.
      setError('That didn’t go through. Check your signal and try again, or reload the page to see whether it already did.');
    } finally {
      setBusy(false);
    }
  }

  if (done === 'approve') {
    return (
      <div className="rounded-2xl border border-[var(--color-spring)]/30 bg-[var(--color-mist)] p-6">
        <p className="text-lg font-bold">Approved. It’s on the website now.</p>
        <p className="mt-2">
          <Link href={`/news/${slug}`} className="font-semibold text-[var(--color-spring)] underline underline-offset-2">
            See the live post
          </Link>
        </p>
      </div>
    );
  }
  if (done === 'decline') {
    return (
      <div className="rounded-2xl border border-[var(--color-line-strong)] bg-white p-6">
        <p className="text-lg font-bold">Got it. This one won’t go up.</p>
        <p className="mt-2 text-[var(--color-ink-soft)]">
          Grokbot will write a new post on its next run{note.trim() ? ', and it will read your note first' : ''}.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-[var(--color-line-strong)] bg-white p-6">
      <p className="text-lg font-bold">Happy with this post?</p>
      <p className="mt-1 text-[var(--color-ink-soft)]">
        Nothing goes on the website until you approve it.
      </p>
      {error && (
        <p className="mt-4 rounded-xl bg-[var(--color-coral)]/10 p-3 text-sm" role="alert">
          {error}
        </p>
      )}
      {declining ? (
        <div className="mt-5">
          <label htmlFor="review-note" className="block font-semibold">
            What should change? <span className="font-normal text-[var(--color-ink-soft)]">(optional)</span>
          </label>
          <textarea
            id="review-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={1000}
            rows={4}
            placeholder="For example: we don’t go to that spring any more, or talk more about the morning tours."
            className="mt-2 w-full rounded-xl border border-[var(--color-line-strong)] p-3"
          />
          <p className="mt-1 text-sm text-[var(--color-ink-soft)]">Grokbot reads this before it writes the next post.</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Button type="button" onClick={() => decide('decline')} disabled={busy}>
              Don’t publish
            </Button>
            <Button type="button" variant="outline" onClick={() => setDeclining(false)} disabled={busy}>
              Back
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-5 flex flex-wrap gap-3">
          <Button type="button" size="lg" onClick={() => decide('approve')} disabled={busy}>
            Approve &amp; publish
          </Button>
          <Button type="button" size="lg" variant="outline" onClick={() => setDeclining(true)} disabled={busy}>
            Don’t publish
          </Button>
        </div>
      )}
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { admin } from '@/lib/admin-client';
import { FunctionError } from '@/lib/functions-client';
import {
  listAllTestimonials,
} from '@/lib/admin-firestore';
import { clsx } from '@/lib/clsx';

interface Row {
  id: string;
  quote: string;
  author: string;
  location: string | null;
  rating: number | null;
  source: 'google' | 'tripadvisor' | 'facebook' | 'instagram' | 'direct' | 'other';
  sourceUrl: string | null;
  reviewedAt: string | null;
  featured: boolean;
  published: boolean;
  order: number;
}

const SOURCES: Array<{ value: Row['source']; label: string }> = [
  { value: 'google', label: 'Google' },
  { value: 'tripadvisor', label: 'Tripadvisor' },
  { value: 'facebook', label: 'Facebook' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'direct', label: 'Direct (email/text)' },
  { value: 'other', label: 'Other' },
];

const inputClass =
  'w-full rounded-xl border border-[var(--color-ink)]/15 bg-white px-3 py-2 text-sm focus:border-[var(--color-brand-blue)] focus:outline-2 focus:outline-[var(--color-brand-blue)]/20';

function blankRow(): Omit<Row, 'id'> {
  return {
    quote: '',
    author: '',
    location: null,
    rating: null,
    source: 'direct',
    sourceUrl: null,
    reviewedAt: null,
    featured: false,
    published: true,
    order: 100,
  };
}

export function ReviewsAdmin() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [editing, setEditing] = useState<Row | (Omit<Row, 'id'> & { id?: undefined }) | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setError(null);
    try {
      const list = (await listAllTestimonials()) as Row[];
      setRows(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load.');
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function save() {
    if (!editing) return;
    if (!editing.quote.trim() || !editing.author.trim()) {
      setError('Quote and author are required.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await admin.upsertTestimonial({
        id: editing.id,
        quote: editing.quote.trim(),
        author: editing.author.trim(),
        location: editing.location?.trim() || undefined,
        rating: editing.rating ?? undefined,
        source: editing.source,
        sourceUrl: editing.sourceUrl?.trim() || undefined,
        reviewedAt: editing.reviewedAt || undefined,
        featured: editing.featured,
        published: editing.published,
        order: editing.order,
      });
      setFlash(editing.id ? 'Updated.' : 'Added.');
      setEditing(null);
      await refresh();
    } catch (err) {
      setError(
        err instanceof FunctionError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Save failed.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!confirm('Delete this review? This cannot be undone.')) return;
    try {
      await admin.deleteTestimonial(id);
      setFlash('Deleted.');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed.');
    }
  }

  async function togglePublished(row: Row) {
    try {
      await admin.upsertTestimonial({
        id: row.id,
        quote: row.quote,
        author: row.author,
        location: row.location ?? undefined,
        rating: row.rating ?? undefined,
        source: row.source,
        sourceUrl: row.sourceUrl ?? undefined,
        reviewedAt: row.reviewedAt ?? undefined,
        featured: row.featured,
        published: !row.published,
        order: row.order,
      });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed.');
    }
  }

  async function toggleFeatured(row: Row) {
    try {
      await admin.upsertTestimonial({
        id: row.id,
        quote: row.quote,
        author: row.author,
        location: row.location ?? undefined,
        rating: row.rating ?? undefined,
        source: row.source,
        sourceUrl: row.sourceUrl ?? undefined,
        reviewedAt: row.reviewedAt ?? undefined,
        featured: !row.featured,
        published: row.published,
        order: row.order,
      });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed.');
    }
  }

  return (
    <div className="space-y-5">
      {flash && (
        <div className="rounded-2xl bg-[var(--color-brand-blue)]/10 border border-[var(--color-brand-blue)]/20 p-3 text-sm">
          {flash}
        </div>
      )}
      {error && (
        <div className="rounded-2xl bg-[var(--color-coral)]/10 border border-[var(--color-coral)]/30 p-3 text-sm">
          {error}
        </div>
      )}

      <div className="flex justify-between items-center">
        <p className="text-sm text-[var(--color-ink-soft)]">
          {rows === null ? 'Loading…' : `${rows.length} review${rows.length === 1 ? '' : 's'} on file.`}
        </p>
        <button
          type="button"
          onClick={() => setEditing(blankRow())}
          className="inline-flex items-center px-4 py-2 rounded-full bg-[var(--color-brand-blue)] hover:bg-[var(--color-brand-blue-dark)] text-white text-sm font-medium"
        >
          + Add review
        </button>
      </div>

      <div className="space-y-3">
        {rows?.map((row) => (
          <article
            key={row.id}
            className={clsx(
              'bg-white rounded-2xl border shadow-[var(--shadow-card)] p-5',
              row.published
                ? 'border-[var(--color-ink)]/8'
                : 'border-dashed border-[var(--color-ink)]/15 opacity-70',
            )}
          >
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="flex-1 min-w-0">
                <p className="font-display text-base leading-snug">
                  &ldquo;{row.quote}&rdquo;
                </p>
                <p className="mt-2 text-sm text-[var(--color-ink-soft)]">
                  — {row.author}
                  {row.location && <span> · {row.location}</span>}
                  {row.rating && (
                    <span className="ml-1 text-[var(--color-coral-dark)]">
                      {' '}· {'★'.repeat(row.rating)}{'☆'.repeat(5 - row.rating)}
                    </span>
                  )}
                  <span className="text-xs text-[var(--color-ink-soft)]/70">
                    {' '}· {SOURCES.find((s) => s.value === row.source)?.label}
                    {row.reviewedAt && ` · ${row.reviewedAt}`}
                  </span>
                </p>
              </div>
              <div className="flex flex-wrap gap-1 shrink-0">
                {row.featured && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-[var(--color-coral)]/15 text-[var(--color-coral-dark)] text-xs font-medium">
                    Featured
                  </span>
                )}
                <span
                  className={clsx(
                    'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium',
                    row.published
                      ? 'bg-[var(--color-brand-blue)]/10 text-[var(--color-brand-blue-dark)]'
                      : 'bg-[var(--color-ink)]/10 text-[var(--color-ink-soft)]',
                  )}
                >
                  {row.published ? 'Published' : 'Draft'}
                </span>
                <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-[var(--color-cream)] text-xs font-mono">
                  #{row.order}
                </span>
              </div>
            </div>
            <div className="mt-3 pt-3 border-t border-[var(--color-ink)]/8 flex flex-wrap gap-2 text-xs">
              <button
                type="button"
                onClick={() => setEditing(row)}
                className="px-3 py-1.5 rounded-full border border-[var(--color-ink)]/15 hover:bg-[var(--color-ink)]/5"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => toggleFeatured(row)}
                className="px-3 py-1.5 rounded-full border border-[var(--color-ink)]/15 hover:bg-[var(--color-ink)]/5"
              >
                {row.featured ? 'Un-feature' : 'Feature on home'}
              </button>
              <button
                type="button"
                onClick={() => togglePublished(row)}
                className="px-3 py-1.5 rounded-full border border-[var(--color-ink)]/15 hover:bg-[var(--color-ink)]/5"
              >
                {row.published ? 'Unpublish' : 'Publish'}
              </button>
              <button
                type="button"
                onClick={() => remove(row.id)}
                className="px-3 py-1.5 rounded-full text-[var(--color-coral-dark)] hover:bg-[var(--color-coral)]/10"
              >
                Delete
              </button>
              {row.sourceUrl && (
                <a
                  href={row.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-auto px-3 py-1.5 text-[var(--color-brand-blue)] hover:underline"
                >
                  Source ↗
                </a>
              )}
            </div>
          </article>
        ))}
        {rows?.length === 0 && (
          <div className="bg-[var(--color-cream)] rounded-2xl p-8 text-center text-sm text-[var(--color-ink-soft)]">
            No reviews yet. Add your first one above — copy from Google,
            Tripadvisor, Instagram, or a personal email.
          </div>
        )}
      </div>

      {editing && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-[var(--color-ink)]/40 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto"
          onClick={() => setEditing(null)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl max-w-xl w-full my-8"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 pt-5 pb-3 flex items-center justify-between gap-4 border-b border-[var(--color-ink)]/8">
              <h2 className="font-display text-xl">
                {editing.id ? 'Edit review' : 'Add review'}
              </h2>
              <button
                type="button"
                aria-label="Close"
                onClick={() => setEditing(null)}
                className="w-9 h-9 rounded-full text-[var(--color-ink-soft)] hover:bg-[var(--color-ink)]/8 inline-flex items-center justify-center"
              >
                ×
              </button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <label className="block">
                <span className="block text-sm font-medium mb-1">
                  Review text <span className="text-[var(--color-coral-dark)]">*</span>
                </span>
                <textarea
                  value={editing.quote}
                  onChange={(e) =>
                    setEditing((prev) => prev && { ...prev, quote: e.target.value })
                  }
                  rows={4}
                  maxLength={2000}
                  className={inputClass}
                  placeholder="The kids haven't stopped talking about it."
                />
              </label>

              <div className="grid sm:grid-cols-2 gap-3">
                <label className="block">
                  <span className="block text-sm font-medium mb-1">
                    Author <span className="text-[var(--color-coral-dark)]">*</span>
                  </span>
                  <input
                    type="text"
                    value={editing.author}
                    onChange={(e) =>
                      setEditing((prev) => prev && { ...prev, author: e.target.value })
                    }
                    maxLength={160}
                    className={inputClass}
                    placeholder="The Hutcheson family"
                  />
                </label>
                <label className="block">
                  <span className="block text-sm font-medium mb-1">
                    Location <span className="text-[var(--color-ink-soft)] font-normal">(optional)</span>
                  </span>
                  <input
                    type="text"
                    value={editing.location ?? ''}
                    onChange={(e) =>
                      setEditing((prev) =>
                        prev && { ...prev, location: e.target.value || null },
                      )
                    }
                    maxLength={120}
                    className={inputClass}
                    placeholder="Atlanta GA"
                  />
                </label>
              </div>

              <div className="grid sm:grid-cols-2 gap-3">
                <label className="block">
                  <span className="block text-sm font-medium mb-1">
                    Star rating <span className="text-[var(--color-ink-soft)] font-normal">(optional)</span>
                  </span>
                  <select
                    value={editing.rating ?? ''}
                    onChange={(e) =>
                      setEditing(
                        (prev) =>
                          prev && {
                            ...prev,
                            rating: e.target.value ? Number(e.target.value) : null,
                          },
                      )
                    }
                    className={inputClass}
                  >
                    <option value="">No rating</option>
                    <option value="5">★★★★★ (5)</option>
                    <option value="4">★★★★☆ (4)</option>
                    <option value="3">★★★☆☆ (3)</option>
                    <option value="2">★★☆☆☆ (2)</option>
                    <option value="1">★☆☆☆☆ (1)</option>
                  </select>
                </label>
                <label className="block">
                  <span className="block text-sm font-medium mb-1">Source</span>
                  <select
                    value={editing.source}
                    onChange={(e) =>
                      setEditing(
                        (prev) =>
                          prev && { ...prev, source: e.target.value as Row['source'] },
                      )
                    }
                    className={inputClass}
                  >
                    {SOURCES.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <label className="block">
                <span className="block text-sm font-medium mb-1">
                  Source URL <span className="text-[var(--color-ink-soft)] font-normal">(optional — link back to original)</span>
                </span>
                <input
                  type="url"
                  value={editing.sourceUrl ?? ''}
                  onChange={(e) =>
                    setEditing(
                      (prev) => prev && { ...prev, sourceUrl: e.target.value || null },
                    )
                  }
                  className={inputClass}
                  placeholder="https://google.com/maps/…"
                />
              </label>

              <div className="grid sm:grid-cols-2 gap-3">
                <label className="block">
                  <span className="block text-sm font-medium mb-1">
                    Reviewed date <span className="text-[var(--color-ink-soft)] font-normal">(optional)</span>
                  </span>
                  <input
                    type="date"
                    value={editing.reviewedAt ?? ''}
                    onChange={(e) =>
                      setEditing(
                        (prev) =>
                          prev && { ...prev, reviewedAt: e.target.value || null },
                      )
                    }
                    className={inputClass}
                  />
                </label>
                <label className="block">
                  <span className="block text-sm font-medium mb-1">
                    Display order
                  </span>
                  <input
                    type="number"
                    value={editing.order}
                    onChange={(e) =>
                      setEditing(
                        (prev) =>
                          prev && { ...prev, order: Number(e.target.value) || 100 },
                      )
                    }
                    min={0}
                    max={10000}
                    className={inputClass}
                  />
                </label>
              </div>

              <div className="flex flex-wrap gap-4 pt-1">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={editing.featured}
                    onChange={(e) =>
                      setEditing(
                        (prev) => prev && { ...prev, featured: e.target.checked },
                      )
                    }
                    className="w-4 h-4"
                  />
                  Feature on home page
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={editing.published}
                    onChange={(e) =>
                      setEditing(
                        (prev) => prev && { ...prev, published: e.target.checked },
                      )
                    }
                    className="w-4 h-4"
                  />
                  Published (visible on site)
                </label>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-[var(--color-ink)]/8 flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
              <button
                type="button"
                onClick={() => setEditing(null)}
                disabled={busy}
                className="px-4 py-2 rounded-full border border-[var(--color-ink)]/15 hover:bg-[var(--color-ink)]/5"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={save}
                disabled={busy}
                className="px-4 py-2 rounded-full bg-[var(--color-brand-blue)] hover:bg-[var(--color-brand-blue-dark)] text-white font-medium disabled:opacity-60"
              >
                {busy ? 'Saving…' : 'Save review'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

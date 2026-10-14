'use client';

import { useEffect, type ReactNode } from 'react';

interface Props {
  title: string;
  children: ReactNode;
  onClose: () => void;
  /**
   * True while the dialog's action is running. A stray tap outside the box
   * or on × must not close it then: the result (or the error) would vanish.
   */
  busy?: boolean;
}

export function AdminModal({ title, children, onClose, busy = false }: Props) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !busy) onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 bg-[var(--color-ink)]/40 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto"
      onClick={busy ? undefined : onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl max-w-md w-full my-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 pt-5 pb-3 flex items-center justify-between gap-4 border-b border-[var(--color-ink)]/8">
          <h2 className="font-display text-xl leading-tight">{title}</h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            disabled={busy}
            className="inline-flex items-center justify-center w-11 h-11 -mr-2 rounded-full text-[var(--color-ink-soft)] hover:bg-[var(--color-ink)]/8 disabled:opacity-40"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  );
}

export const adminInputClass =
  'w-full rounded-xl border border-[var(--color-ink)]/15 bg-white px-3 py-2 text-base placeholder:text-[var(--color-ink-soft)]/60 focus:border-[var(--color-brand-blue)] focus:outline-2 focus:outline-[var(--color-brand-blue)]/20';

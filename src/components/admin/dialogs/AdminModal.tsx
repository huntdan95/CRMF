'use client';

import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

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
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !busy) onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  // Move focus into the dialog (its first field, else the × button) and
  // hand it back to whatever opened it when it closes, so keyboard and
  // screen-reader users aren't left behind the overlay.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const box = boxRef.current;
    const field = box?.querySelector<HTMLElement>('input:not([disabled]), select:not([disabled]), textarea:not([disabled])');
    (field ?? box?.querySelector<HTMLElement>(FOCUSABLE))?.focus();
    return () => opener?.focus();
  }, []);

  // Keep Tab inside the dialog while it's open.
  function trapFocus(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'Tab' || !boxRef.current) return;
    const focusable = boxRef.current.querySelectorAll<HTMLElement>(FOCUSABLE);
    if (focusable.length === 0) return;
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  // Centred with my-auto, not items-center: a box taller than the screen
  // (most of them, on a phone) would spill above the top as well as below,
  // and the part above can't be scrolled to. my-auto centres one that fits
  // and starts one that doesn't at the top.
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 bg-[var(--color-ink)]/40 backdrop-blur-sm flex justify-center p-4 overflow-y-auto"
      onClick={busy ? undefined : onClose}
    >
      <div
        ref={boxRef}
        onKeyDown={trapFocus}
        className="bg-white rounded-2xl shadow-2xl max-w-md w-full my-auto overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-3 flex items-center justify-between gap-4 border-b border-[var(--color-line)] bg-[var(--color-paper)]/70">
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

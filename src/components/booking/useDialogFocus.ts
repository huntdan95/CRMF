'use client';

import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])';

/** Inputs that Tab steps through part by part (month, day, year) while they stay the focused element. */
const MULTI_PART = new Set(['date', 'time', 'datetime-local', 'month', 'week']);

function tabbable(box: HTMLElement) {
  // The calendar's days take Tab one at a time (arrows move between them).
  return [...box.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.tabIndex >= 0);
}

function multiPart(el: HTMLElement) {
  return el instanceof HTMLInputElement && MULTI_PART.has(el.type);
}

/**
 * Focus for the booking page's dialogs, as MobileNav does it for the menu:
 * move it to the dialog's heading when it opens (screen readers start at the
 * title, and a phone's keyboard doesn't pop up over the reason box), keep Tab
 * inside while it's open, and hand it back to the button that opened it.
 */
export function useDialogFocus() {
  const boxRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    headingRef.current?.focus();

    // Focus can still end up outside: confirming disables the button it was
    // on, which drops it to the page, and a date field's own Shift+Tab can
    // carry it out past the start. Either way, bring it back in at the end
    // the guest was heading for.
    let backwards = false;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      backwards = e.shiftKey;
      const box = boxRef.current;
      if (!box || box.contains(document.activeElement)) return;
      const focusable = tabbable(box);
      if (focusable.length === 0) return;
      e.preventDefault();
      (backwards ? focusable[focusable.length - 1]! : focusable[0]!).focus();
    };
    const onFocusIn = (e: FocusEvent) => {
      const box = boxRef.current;
      if (!box || !(e.target instanceof Node) || box.contains(e.target)) return;
      const focusable = tabbable(box);
      if (focusable.length === 0) return;
      (backwards ? focusable[focusable.length - 1]! : focusable[0]!).focus();
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('focusin', onFocusIn);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('focusin', onFocusIn);
      opener?.focus();
    };
  }, []);

  function trapFocus(e: ReactKeyboardEvent<HTMLElement>) {
    if (e.key !== 'Tab' || !boxRef.current) return;
    const focusable = tabbable(boxRef.current);
    if (focusable.length === 0) return;
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    // The heading has focus to begin with but isn't in the Tab order itself.
    // A date field at either end is left to step through its own parts: if
    // that takes focus out of the dialog, the focusin check brings it round.
    const active = document.activeElement;
    if (e.shiftKey && (active === headingRef.current || (active === first && !multiPart(first)))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last && !multiPart(last)) {
      e.preventDefault();
      first.focus();
    }
  }

  return { boxRef, headingRef, trapFocus };
}

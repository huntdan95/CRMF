'use client';

import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])';

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
    return () => opener?.focus();
  }, []);

  function trapFocus(e: ReactKeyboardEvent<HTMLElement>) {
    if (e.key !== 'Tab' || !boxRef.current) return;
    // The calendar's days take Tab one at a time (arrows move between them).
    const focusable = [...boxRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.tabIndex >= 0);
    if (focusable.length === 0) return;
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    // The heading has focus to begin with but isn't in the Tab order itself.
    if (e.shiftKey && (document.activeElement === first || document.activeElement === headingRef.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  return { boxRef, headingRef, trapFocus };
}

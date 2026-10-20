'use client';

import { useState, type IframeHTMLAttributes, type ReactNode } from 'react';

/**
 * Another company's embed (the Google map, the YouTube video) that loads
 * only once the visitor asks for it. Until then nothing is fetched from
 * that company, as the privacy policy promises: a lazy iframe still loads
 * for everyone who scrolls past it. `label` is the button that loads it;
 * `children` sit beside the button (a plain link to the same thing,
 * say). `className` sizes the stand-in as the embed is sized.
 */
export function EmbedOnClick({
  frame,
  label,
  className,
  children,
}: {
  frame: IframeHTMLAttributes<HTMLIFrameElement> & { src: string; title: string };
  label: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  const [shown, setShown] = useState(false);
  // Focus moves to the embed in place of the button that's gone.
  if (shown) return <iframe {...frame} ref={(el) => el?.focus()} />;
  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => setShown(true)}
        className="inline-flex min-h-11 items-center gap-2 rounded-full border border-[var(--color-ink)]/15 bg-white px-5 py-2.5 text-sm font-semibold text-[var(--color-ink)] shadow-sm transition-colors hover:bg-[var(--color-paper)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-spring)]"
      >
        {label}
      </button>
      {children}
    </div>
  );
}

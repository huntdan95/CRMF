import { clsx } from '@/lib/clsx';

// Snout at the top, round paddle tail at the bottom; drawn upright on a
// 40×40 grid and rotated so it swims up and to the right.
export const MANATEE_BODY =
  'M20 4C22.4 4 23.9 5 24.1 7C24.4 8.8 24.3 9.9 24.7 11.1C25.6 13.1 27 15.4 27 19C27 23.4 24.8 26.6 22.5 28.4' +
  'C22.2 28.7 22.4 29.2 23 29.6C25.6 30.6 27.9 32.2 27.7 34.4C27.5 36.8 24 38 20 38C16 38 12.5 36.8 12.3 34.4' +
  'C12.1 32.2 14.4 30.6 17 29.6C17.6 29.2 17.8 28.7 17.5 28.4C15.2 26.6 13 23.4 13 19C13 15.4 14.4 13.1 15.3 11.1' +
  'C15.7 9.9 15.6 8.8 15.9 7C16.1 5 17.6 4 20 4Z';

/**
 * A manatee seen from above — the view every snorkeler gets — swimming
 * up and to the right. Plain shapes so it holds up at favicon size.
 */
export function ManateeMark({
  size = 36,
  className,
  title,
}: {
  size?: number;
  className?: string;
  title?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      className={className}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      <g transform="rotate(38 20 20)" fill="currentColor">
        <path d={MANATEE_BODY} />
        <ellipse cx="28.3" cy="15.6" rx="1.5" ry="3.2" transform="rotate(-48 28.3 15.6)" />
        <ellipse cx="11.7" cy="15.6" rx="1.5" ry="3.2" transform="rotate(48 11.7 15.6)" />
      </g>
    </svg>
  );
}

export function Logo({
  tone = 'dark',
  className,
}: {
  /** `dark` = ink type for light backgrounds; `light` = white type over photos. */
  tone?: 'dark' | 'light';
  className?: string;
}) {
  const light = tone === 'light';
  return (
    <span className={clsx('inline-flex items-center gap-2.5', className)}>
      <span
        className={clsx(
          'inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full',
          light ? 'bg-white/15 text-white ring-1 ring-white/30' : 'bg-[var(--color-spring-deep)] text-[var(--color-spring-bright)]',
        )}
      >
        <ManateeMark size={28} />
      </span>
      <span className="flex flex-col leading-none">
        <span
          className={clsx(
            'text-[0.625rem] font-semibold uppercase tracking-[0.16em]',
            light ? 'text-white/80' : 'text-[var(--color-spring)]',
          )}
        >
          Crystal River
        </span>
        <span
          className={clsx(
            'mt-1 text-display text-[1.2rem] tracking-[-0.02em]',
            light ? 'text-white' : 'text-[var(--color-ink)]',
          )}
        >
          Manatee Fun
        </span>
      </span>
    </span>
  );
}

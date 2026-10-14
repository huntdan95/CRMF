import type { ReactNode } from 'react';
import { clsx } from '@/lib/clsx';

/**
 * Shared look for the admin screens: cards with a visible edge on the
 * limestone background, a tinted header and footer so each card reads as
 * one unit, and form fields that stand out from the white card they sit in.
 */

/** A white card. Add `overflow-hidden` when it has a PanelHeader or PanelFooter. */
export const panelClass =
  'bg-white rounded-2xl border border-[var(--color-line)] shadow-[var(--shadow-panel)]';

export const inputClass =
  'w-full min-h-11 rounded-[10px] border border-[var(--color-line-strong)] bg-white px-3 py-2 text-base ' +
  'shadow-[inset_0_1px_2px_rgba(14,32,30,0.06)] placeholder:text-[var(--color-ink-soft)]/60 ' +
  'transition-colors hover:border-[var(--color-ink-soft)] ' +
  'focus:border-[var(--color-spring)] focus:outline-2 focus:outline-offset-0 focus:outline-[var(--color-spring)]/25 ' +
  'disabled:bg-[var(--color-paper)] disabled:text-[var(--color-ink-soft)]';

export const labelClass = 'block text-sm font-semibold mb-1.5';

export const hintClass = 'block text-xs text-[var(--color-ink-soft)] mt-1.5';

const buttonBase =
  'inline-flex items-center justify-center gap-2 rounded-[10px] font-semibold whitespace-nowrap transition-colors ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-spring)] ' +
  'disabled:opacity-60 disabled:cursor-not-allowed';

const buttonVariants = {
  primary:
    'bg-[var(--color-spring)] text-white shadow-[0_1px_2px_rgba(14,32,30,0.18)] hover:bg-[var(--color-spring-deep)]',
  secondary:
    'border border-[var(--color-line-strong)] bg-white text-[var(--color-ink)] hover:border-[var(--color-ink-soft)] hover:bg-[var(--color-paper)]',
  danger: 'text-[var(--color-coral-dark)] hover:bg-[var(--color-coral)]/10',
  /** For the one step that can't be undone, like closing a day with bookings on it. */
  destructive: 'bg-[var(--color-coral)] text-white hover:bg-[var(--color-coral-dark)]',
} as const;

const buttonSizes = {
  sm: 'min-h-9 px-3 text-sm',
  md: 'min-h-11 px-5 text-[0.9375rem]',
} as const;

export function buttonClass(
  variant: keyof typeof buttonVariants = 'primary',
  size: keyof typeof buttonSizes = 'md',
): string {
  return clsx(buttonBase, buttonVariants[variant], buttonSizes[size]);
}

export function AdminPageHeader({
  title,
  description,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  /** Anything under the description, like on-page links. */
  children?: ReactNode;
}) {
  return (
    <header className="mb-8 pb-6 border-b border-[var(--color-line)]">
      <h1 className="text-display text-[2rem] sm:text-[2.5rem]">{title}</h1>
      {description && (
        <p className="mt-2 max-w-3xl text-[0.9375rem] leading-relaxed text-[var(--color-ink-soft)]">
          {description}
        </p>
      )}
      {children}
    </header>
  );
}

/** Heading for a group of cards on a page. */
export function SectionHeading({
  id,
  title,
  description,
  aside,
}: {
  id?: string;
  title: ReactNode;
  description?: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <div id={id} className="scroll-mt-20 mb-4 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
      <div className="min-w-0">
        <h2 className="font-display text-xl sm:text-[1.375rem] leading-tight">{title}</h2>
        {description && (
          <p className="mt-1 max-w-2xl text-sm text-[var(--color-ink-soft)]">{description}</p>
        )}
      </div>
      {aside}
    </div>
  );
}

export function PanelHeader({
  title,
  description,
  leading,
  aside,
  as: Heading = 'h2',
}: {
  title: ReactNode;
  description?: ReactNode;
  /** Shown before the title, e.g. a departure time or a date. */
  leading?: ReactNode;
  /** Right-hand side: status, a switch, a count. */
  aside?: ReactNode;
  as?: 'h2' | 'h3';
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-3 px-5 py-4 border-b border-[var(--color-line)] bg-[var(--color-paper)]/70">
      {leading}
      {/* The basis makes a wide `aside` (a switch) drop to its own row on a phone. */}
      <div className="min-w-0 flex-1 basis-48">
        <Heading className="font-display text-lg leading-tight">{title}</Heading>
        {description && (
          <div className="mt-1 text-sm text-[var(--color-ink-soft)]">{description}</div>
        )}
      </div>
      {aside && <div className="flex items-center gap-2 flex-wrap">{aside}</div>}
    </div>
  );
}

export function PanelBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx('p-5', className)}>{children}</div>;
}

/** Bottom bar for a card's buttons, right-aligned. Give status text `mr-auto` to sit it on the left. */
export function PanelFooter({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-3 px-5 py-3.5 border-t border-[var(--color-line)] bg-[var(--color-paper)]/70">
      {children}
    </div>
  );
}

const badgeTones = {
  spring: 'bg-[var(--color-mist)] text-[var(--color-spring-deep)] ring-[var(--color-spring)]/25',
  sand: 'bg-[var(--color-sand)] text-[var(--color-ink)] ring-[var(--color-ink)]/10',
  buoy: 'bg-[var(--color-buoy)]/12 text-[var(--color-coral-dark)] ring-[var(--color-buoy)]/35',
  muted: 'bg-[var(--color-ink)]/[0.06] text-[var(--color-ink-soft)] ring-[var(--color-ink)]/10',
} as const;

export function Badge({
  tone = 'muted',
  children,
  className,
}: {
  tone?: keyof typeof badgeTones;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ring-1 ring-inset',
        badgeTones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** On/off switch. It's a checkbox underneath, announced as a switch. */
export function Switch({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: ReactNode;
}) {
  return (
    <label className="inline-flex min-h-11 items-center gap-3 cursor-pointer select-none">
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="peer sr-only"
      />
      <span
        aria-hidden
        className={clsx(
          'relative inline-flex h-6 w-11 shrink-0 rounded-full bg-[var(--color-ink)]/25 transition-colors',
          'after:absolute after:left-0.5 after:top-0.5 after:h-5 after:w-5 after:rounded-full after:bg-white after:shadow-sm after:transition-transform',
          'peer-checked:bg-[var(--color-spring)] peer-checked:after:translate-x-5',
          'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--color-spring)]',
        )}
      />
      <span className="text-sm font-semibold">{children}</span>
    </label>
  );
}

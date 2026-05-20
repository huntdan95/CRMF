import type { ReactNode } from 'react';
import { clsx } from '@/lib/clsx';

interface Props {
  children: ReactNode;
  /** Optional page-section background tint. */
  tone?: 'cream' | 'white' | 'blue' | 'manatee';
  className?: string;
  /** Vertical padding scale. */
  size?: 'sm' | 'md' | 'lg';
  id?: string;
}

const toneClass = {
  cream: 'bg-[var(--color-cream)] text-[var(--color-ink)]',
  white: 'bg-white text-[var(--color-ink)]',
  blue: 'bg-[var(--color-brand-blue)] text-white',
  manatee: 'bg-[var(--color-manatee)]/15 text-[var(--color-ink)]',
} as const;

const sizeClass = {
  sm: 'py-10 sm:py-12',
  md: 'py-14 sm:py-20',
  lg: 'py-20 sm:py-28',
} as const;

export function Section({
  children,
  tone = 'cream',
  size = 'md',
  className = '',
  id,
}: Props) {
  return (
    <section id={id} className={clsx(toneClass[tone], sizeClass[size], className)}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">{children}</div>
    </section>
  );
}

export function SectionTitle({
  eyebrow,
  title,
  description,
  align = 'center',
  invert = false,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  align?: 'center' | 'left';
  invert?: boolean;
}) {
  return (
    <div
      className={clsx(
        'max-w-2xl',
        align === 'center' && 'mx-auto text-center',
      )}
    >
      {eyebrow && (
        <p
          className={clsx(
            'text-sm font-medium uppercase tracking-widest',
            invert ? 'text-[var(--color-cream)]' : 'text-[var(--color-coral-dark)]',
          )}
        >
          {eyebrow}
        </p>
      )}
      <h2
        className={clsx(
          'mt-2 font-display text-3xl sm:text-4xl lg:text-5xl leading-tight',
          invert ? 'text-white' : 'text-[var(--color-ink)]',
        )}
      >
        {title}
      </h2>
      {description && (
        <p
          className={clsx(
            'mt-4 text-base sm:text-lg leading-relaxed',
            invert ? 'text-white/85' : 'text-[var(--color-ink-soft)]',
          )}
        >
          {description}
        </p>
      )}
    </div>
  );
}

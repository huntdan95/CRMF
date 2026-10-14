import type { ReactNode } from 'react';
import { clsx } from '@/lib/clsx';

/** Page-width wrapper. Every marketing section lines up on this. */
export function Container({
  children,
  className,
  size = 'default',
}: {
  children: ReactNode;
  className?: string;
  size?: 'default' | 'narrow' | 'prose';
}) {
  return (
    <div
      className={clsx(
        'mx-auto w-full px-5 sm:px-8',
        size === 'default' && 'max-w-[1240px]',
        size === 'narrow' && 'max-w-[960px]',
        size === 'prose' && 'max-w-[760px]',
        className,
      )}
    >
      {children}
    </div>
  );
}

interface Props {
  children: ReactNode;
  tone?: 'paper' | 'white' | 'mist' | 'deep' | 'ink';
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  container?: 'default' | 'narrow' | 'prose';
  id?: string;
}

const toneClass = {
  paper: 'bg-[var(--color-paper)] text-[var(--color-ink)]',
  white: 'bg-white text-[var(--color-ink)]',
  mist: 'bg-[var(--color-mist)] text-[var(--color-ink)]',
  deep: 'bg-[var(--color-spring-deep)] text-white',
  ink: 'bg-[var(--color-ink)] text-white',
} as const;

const sizeClass = {
  sm: 'py-12 sm:py-16',
  md: 'py-16 sm:py-24',
  lg: 'py-20 sm:py-32',
} as const;

export function Section({
  children,
  tone = 'paper',
  size = 'md',
  container = 'default',
  className,
  id,
}: Props) {
  return (
    <section id={id} className={clsx(toneClass[tone], sizeClass[size], className)}>
      <Container size={container}>{children}</Container>
    </section>
  );
}

/**
 * Section heading block. `kicker` is a short plain-language lead-in, used
 * only where it adds information ("Shared · $84 a seat"), not as decoration.
 */
export function SectionTitle({
  kicker,
  title,
  description,
  align = 'left',
  invert = false,
  as: Heading = 'h2',
  size = 'md',
  className,
}: {
  kicker?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  align?: 'center' | 'left';
  invert?: boolean;
  as?: 'h1' | 'h2';
  size?: 'md' | 'lg';
  className?: string;
}) {
  return (
    <div
      className={clsx(
        'max-w-3xl',
        align === 'center' && 'mx-auto text-center',
        className,
      )}
    >
      {kicker && (
        <p
          className={clsx(
            'text-label mb-4',
            invert ? 'text-[var(--color-spring-bright)]' : 'text-[var(--color-spring)]',
          )}
        >
          {kicker}
        </p>
      )}
      <Heading
        className={clsx(
          'text-display',
          size === 'lg'
            ? 'text-[2.6rem] sm:text-6xl lg:text-7xl'
            : 'text-[2.1rem] sm:text-5xl lg:text-[3.5rem]',
          invert ? 'text-white' : 'text-[var(--color-ink)]',
        )}
      >
        {title}
      </Heading>
      {description && (
        <div
          className={clsx(
            'mt-5 text-lg leading-relaxed',
            align === 'center' && 'mx-auto',
            'max-w-2xl',
            invert ? 'text-white/75' : 'text-[var(--color-ink-soft)]',
          )}
        >
          {description}
        </div>
      )}
    </div>
  );
}

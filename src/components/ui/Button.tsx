import Link from 'next/link';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { clsx } from '@/lib/clsx';

type Variant = 'primary' | 'dark' | 'outline' | 'light' | 'glass' | 'ghost';
type Size = 'sm' | 'md' | 'lg';

// No focus ring classes here: the one in globals.css wins over them anyway,
// and it already picks spring on light sections, the bright accent on dark.
const base =
  'inline-flex items-center justify-center gap-2 rounded-[10px] font-semibold whitespace-nowrap ' +
  'transition-[background-color,border-color,color,transform] duration-150 active:translate-y-px ' +
  'disabled:opacity-50 disabled:cursor-not-allowed disabled:active:translate-y-0 select-none';

const variantClasses: Record<Variant, string> = {
  // Orange buoy with ink text: 5:1 contrast, and it's the only orange
  // thing on most screens, so it always reads as "book".
  primary:
    'bg-[var(--color-buoy)] text-[var(--color-ink)] hover:bg-[var(--color-buoy-deep)]',
  dark:
    'bg-[var(--color-ink)] text-white hover:bg-[var(--color-spring-deep)]',
  outline:
    'border border-[var(--color-ink)]/20 text-[var(--color-ink)] hover:border-[var(--color-ink)]',
  light:
    'bg-white text-[var(--color-ink)] hover:bg-[var(--color-mist)]',
  glass:
    'border border-white/30 bg-white/10 text-white backdrop-blur-md hover:bg-white/20',
  ghost:
    'text-[var(--color-spring)] hover:bg-[var(--color-spring)]/8',
};

const sizeClasses: Record<Size, string> = {
  sm: 'h-9 px-3.5 text-sm',
  md: 'h-11 px-5 text-[0.9375rem]',
  lg: 'h-[3.25rem] px-6 text-base',
};

interface CommonProps {
  variant?: Variant;
  size?: Size;
  children: ReactNode;
  className?: string;
}

type LinkProps = CommonProps &
  Omit<ComponentPropsWithoutRef<typeof Link>, 'className' | 'children'> & {
    href: string;
  };

type ButtonProps = CommonProps &
  Omit<ComponentPropsWithoutRef<'button'>, 'className' | 'children'> & {
    href?: undefined;
  };

export function buttonClasses({
  variant = 'primary',
  size = 'md',
  className,
}: { variant?: Variant; size?: Size; className?: string } = {}) {
  return clsx(base, variantClasses[variant], sizeClasses[size], className);
}

export function Button(props: LinkProps | ButtonProps) {
  const { variant = 'primary', size = 'md', className = '', children, ...rest } = props;
  const classes = buttonClasses({ variant, size, className });

  if ('href' in rest && rest.href) {
    const { href, ...linkRest } = rest as LinkProps;
    // tel:, mailto: and off-site links don't go through the router.
    if (/^(tel:|mailto:|https?:)/.test(href)) {
      // Router-only props have no meaning on a plain <a>.
      const anchorRest = { ...(linkRest as Record<string, unknown>) };
      delete anchorRest.prefetch;
      delete anchorRest.replace;
      delete anchorRest.scroll;
      return (
        <a href={href} className={classes} {...(anchorRest as ComponentPropsWithoutRef<'a'>)}>
          {children}
        </a>
      );
    }
    return (
      <Link href={href} className={classes} {...linkRest}>
        {children}
      </Link>
    );
  }

  return (
    <button className={classes} {...(rest as ButtonProps)}>
      {children}
    </button>
  );
}

import Link from 'next/link';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost';
type Size = 'sm' | 'md' | 'lg';

const base =
  'inline-flex items-center justify-center gap-2 rounded-full font-medium ' +
  'transition-all duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 ' +
  'disabled:opacity-50 disabled:cursor-not-allowed select-none';

const variantClasses: Record<Variant, string> = {
  primary:
    'bg-[var(--color-coral)] text-white shadow-[var(--shadow-card)] ' +
    'hover:bg-[var(--color-coral-dark)] hover:shadow-[var(--shadow-soft)] hover:-translate-y-px ' +
    'focus-visible:outline-[var(--color-coral)]',
  secondary:
    'bg-white text-[var(--color-brand-blue)] border border-[var(--color-brand-blue)] ' +
    'hover:bg-[var(--color-brand-blue)] hover:text-white ' +
    'focus-visible:outline-[var(--color-brand-blue)]',
  ghost:
    'bg-transparent text-[var(--color-brand-blue)] hover:bg-[var(--color-brand-blue)]/8 ' +
    'focus-visible:outline-[var(--color-brand-blue)]',
};

const sizeClasses: Record<Size, string> = {
  sm: 'px-4 py-2 text-sm',
  md: 'px-5 py-2.5 text-base',
  lg: 'px-7 py-3.5 text-lg',
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

export function Button(props: LinkProps | ButtonProps) {
  const { variant = 'primary', size = 'md', className = '', children, ...rest } = props;
  const classes = `${base} ${variantClasses[variant]} ${sizeClasses[size]} ${className}`;

  if ('href' in rest && rest.href) {
    const { href, ...linkRest } = rest as LinkProps;
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

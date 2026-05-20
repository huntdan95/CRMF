import { clsx } from '@/lib/clsx';

interface Props {
  /** Caption shown inside the placeholder so the owner knows what photo lives here. */
  label: string;
  aspect?: 'square' | 'video' | 'portrait' | 'wide' | 'auto';
  /** Tailwind background-color utility, e.g. "bg-[var(--color-brand-blue)]". */
  tone?: string;
  className?: string;
  rounded?: 'lg' | '2xl' | 'full' | 'none';
}

const aspectClass: Record<NonNullable<Props['aspect']>, string> = {
  square: 'aspect-square',
  video: 'aspect-video',
  portrait: 'aspect-[3/4]',
  wide: 'aspect-[21/9]',
  auto: '',
};

const roundedClass: Record<NonNullable<Props['rounded']>, string> = {
  lg: 'rounded-lg',
  '2xl': 'rounded-2xl',
  full: 'rounded-full',
  none: '',
};

/**
 * Inline placeholder for marketing photos. Owner will replace these with real
 * imagery (drop files into `/public/images/` and swap to `<Image>`).
 */
export function PlaceholderImage({
  label,
  aspect = 'video',
  tone = 'bg-[var(--color-brand-blue)]/15',
  className = '',
  rounded = '2xl',
}: Props) {
  return (
    <div
      role="img"
      aria-label={label}
      className={clsx(
        'relative w-full overflow-hidden flex items-center justify-center',
        'border border-[var(--color-brand-blue)]/10',
        aspectClass[aspect],
        roundedClass[rounded],
        tone,
        className,
      )}
    >
      <div className="absolute inset-0 opacity-30 bg-[radial-gradient(circle_at_30%_20%,var(--color-cream),transparent_60%)]" />
      <div className="relative z-10 text-center px-6 py-3 max-w-[80%]">
        <p className="text-xs uppercase tracking-widest text-[var(--color-brand-blue-dark)] font-medium opacity-70">
          Photo
        </p>
        <p className="font-display text-base sm:text-lg text-[var(--color-ink)] mt-1 leading-snug">
          {label}
        </p>
      </div>
    </div>
  );
}

import { clsx } from '@/lib/clsx';

const STEPS = ['Date', 'Tour', 'Details', 'Pay'] as const;

interface Props {
  current: number; // 1-based
}

export function BookingSteps({ current }: Props) {
  return (
    <ol className="flex items-center gap-2 sm:gap-4" aria-label="Booking progress">
      {STEPS.map((label, i) => {
        const step = i + 1;
        const done = step < current;
        const active = step === current;
        return (
          <li key={label} className="flex items-center gap-2 sm:gap-3">
            <span
              aria-current={active ? 'step' : undefined}
              className={clsx(
                'inline-flex h-7 w-7 sm:h-8 sm:w-8 items-center justify-center rounded-full text-sm font-medium',
                done && 'bg-[var(--color-brand-blue)] text-white',
                active && 'bg-[var(--color-coral)] text-white shadow-[var(--shadow-card)]',
                !done && !active && 'bg-[var(--color-ink)]/10 text-[var(--color-ink-soft)]',
              )}
            >
              {done ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path
                    d="M5 12.5l4 4 10-10"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              ) : (
                step
              )}
            </span>
            <span
              className={clsx(
                'text-xs sm:text-sm hidden xs:inline',
                active ? 'font-medium text-[var(--color-ink)]' : 'text-[var(--color-ink-soft)]',
              )}
            >
              {label}
            </span>
            {i < STEPS.length - 1 && (
              <span
                aria-hidden
                className="w-4 sm:w-8 h-px bg-[var(--color-ink)]/15 hidden xs:inline-block"
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

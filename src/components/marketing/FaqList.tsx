import type { Faq } from '@/lib/faq';
import { Plus } from '@/components/ui/icons';
import { clsx } from '@/lib/clsx';

/** Accordion of questions. Plain <details>, so it works without JavaScript. */
export function FaqList({ faqs, invert = false }: { faqs: Faq[]; invert?: boolean }) {
  return (
    <div className={clsx('border-t', invert ? 'border-white/15' : 'border-[var(--color-ink)]/12')}>
      {faqs.map((f) => (
        <details
          key={f.q}
          className={clsx('group border-b', invert ? 'border-white/15' : 'border-[var(--color-ink)]/12')}
        >
          <summary className="flex cursor-pointer list-none items-start justify-between gap-6 py-5">
            <h3 className="text-[1.0625rem] font-semibold leading-snug sm:text-lg">{f.q}</h3>
            <span
              aria-hidden
              className={clsx(
                'mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border transition-transform duration-200 group-open:rotate-45',
                invert ? 'border-white/25' : 'border-[var(--color-ink)]/20',
              )}
            >
              <Plus size={14} />
            </span>
          </summary>
          <p
            className={clsx(
              '-mt-1 max-w-3xl pb-6 pr-12 leading-relaxed',
              invert ? 'text-white/75' : 'text-[var(--color-ink-soft)]',
            )}
          >
            {f.a}
          </p>
        </details>
      ))}
    </div>
  );
}

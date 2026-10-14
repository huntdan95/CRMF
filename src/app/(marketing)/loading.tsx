import { Spinner } from '@/components/ui/icons';

export default function MarketingLoading() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center gap-3 text-[var(--color-ink-soft)]">
      <Spinner size={20} />
      Loading…
    </div>
  );
}

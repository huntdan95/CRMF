import { Button } from '@/components/ui/Button';

/**
 * "Everyone signs the waiver" prompt for the booker's confirmation and
 * manage-booking pages. Links with the booker's own token; the waiver page
 * swaps it for a shareable signing key before they can copy the URL.
 */
export function WaiverCallout({ bookingId, accessToken }: { bookingId: string; accessToken: string }) {
  return (
    <div className="rounded-2xl border border-[var(--color-spring)]/25 bg-[var(--color-mist)] p-5 sm:p-6">
      <h3 className="text-lg font-bold">Before the trip: everyone signs the waiver</h3>
      <p className="mt-1.5 text-sm leading-relaxed text-[var(--color-ink-soft)]">
        Every adult on the boat signs their own liability waiver on their phone. It takes about 3
        minutes. A parent or legal guardian signs for anyone under 18. Sign yours, then share the
        link with your party.
      </p>
      <Button href={`/waiver/${bookingId}?t=${accessToken}`} variant="dark" className="mt-4">
        Sign the waiver
      </Button>
    </div>
  );
}

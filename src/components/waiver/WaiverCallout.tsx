'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { waiverSigningLink } from '@/lib/waiver/link';

/**
 * "Everyone signs the waiver" prompt for the booker's confirmation and
 * manage-booking pages. Links with the shareable signing key, not the
 * booker's own token: the copy tells them to share the link, and a copied
 * token link could cancel the booking. Until the key is worked out (a
 * moment, in the browser), or if this browser can't work it out, it links
 * with the token; the waiver page swaps that for the key straight away.
 */
export function WaiverCallout({ bookingId, accessToken }: { bookingId: string; accessToken: string }) {
  const [href, setHref] = useState(`/waiver/${bookingId}?t=${accessToken}`);

  useEffect(() => {
    let live = true;
    waiverSigningLink('', bookingId, accessToken).then(
      (link) => {
        if (live) setHref(link);
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [bookingId, accessToken]);

  return (
    <div className="rounded-2xl border border-[var(--color-spring)]/25 bg-[var(--color-mist)] p-5 sm:p-6">
      <h3 className="text-lg font-bold">Before the trip: everyone signs the waiver</h3>
      <p className="mt-1.5 text-sm leading-relaxed text-[var(--color-ink-soft)]">
        Every adult on the boat signs their own liability waiver on their phone. It takes about 3
        minutes. A parent or legal guardian signs for anyone under 18. Sign yours, then share the
        link with your party.
      </p>
      <Button href={href} variant="dark" className="mt-4">
        Sign the waiver
      </Button>
    </div>
  );
}

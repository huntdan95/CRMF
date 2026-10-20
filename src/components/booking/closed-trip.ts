import type { FetchedBooking } from '@/lib/functions-client';
import { inRefundGrace } from '@/lib/refund-policy';

/**
 * Where a booking stands on a departure Travis closed without offering it a
 * new date (no `closure` on it), for the booking and confirmation pages, so
 * both say the same.
 */
export interface ClosedTrip {
  /**
   * A closed day covers the trip and they're still on it: Travis left them
   * booked (or is closing it right now), so it isn't going out. The pages
   * say so, with no Where to meet, waiver callout or calendar, and once its
   * time has gone it's a trip that didn't run, not a past tour. An old-site
   * reservation is a real trip, so it counts; a checkout never paid for
   * doesn't.
   */
  closedBooked: boolean;
  /**
   * Travis is calling it off right now ("cancel" or "offer", in its undo
   * window or going out): what to tell them instead of offering any change.
   * The email that cancels them or offers a new date is minutes away.
   */
  callingOff: string | null;
  /**
   * Closed and left booked, but put back on it by an earlier reopen whose
   * full refund still stands (`refundGraceUntil`): cancelBooking gives it
   * even on a closed departure, so Cancel stays beside the closed notice.
   * Not an old-site booking, which can't be cancelled online, nor while it's
   * being called off, when cancelBooking turns it away.
   */
  canCancelInGrace: boolean;
}

export function closedTrip(booking: FetchedBooking, now: Date = new Date()): ClosedTrip {
  const oldSite = booking.id.startsWith('legacy-');
  const closedBooked =
    (booking.status === 'confirmed' || (booking.status === 'pending-payment' && oldSite)) &&
    !booking.closure &&
    !!booking.departureClosed;
  const callingOff = closedBooked ? (booking.closurePending?.message ?? null) : null;
  return {
    closedBooked,
    callingOff,
    canCancelInGrace:
      closedBooked && !callingOff && booking.status === 'confirmed' && !oldSite && inRefundGrace(booking.refundGraceUntil, now),
  };
}

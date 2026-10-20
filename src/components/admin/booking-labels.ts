// Plain-English wording for bookings, shared by the admin list, detail page
// and calendar so Travis sees the same words everywhere — never raw values
// like `pending-payment` or `partial-refund`.

import type { BookingDoc } from '@/lib/admin-firestore';
import { marinaNow } from '@/lib/availability';
import { parseIsoDate } from '@/lib/date';
import { formatClock, slotLabels, slotOrder, type TourTimeSlot } from '@/lib/tours';
import { SLOT_MINUTES, slotStartMinutes } from '@/lib/schedule';
import type { BadgeTone } from './ui';

/** Imported from the old WordPress site by scripts/import-legacy-bookings.ts. */
export function isLegacy(b: BookingDoc): boolean {
  return !!b.legacy || b.id.startsWith('legacy-');
}

/**
 * Money for this booking was taken through this site's Stripe checkout, so
 * the site can refund it. Imported bookings were paid on the old site.
 */
export function canRefundHere(b: BookingDoc): boolean {
  return !!b.stripePaymentIntentId && !isLegacy(b);
}

/** Travis closed the departure and the customer hasn't picked a new date or a refund yet. */
export function awaitingMove(b: BookingDoc): boolean {
  return !!b.closure && (b.status === 'confirmed' || b.status === 'pending-payment');
}

export function statusLabel(b: BookingDoc): string {
  if (awaitingMove(b)) return 'Closed: customer choosing';
  switch (b.status) {
    case 'pending-payment':
      if (isLegacy(b)) return b.amountPaidCents > 0 ? 'Deposit paid (old site)' : 'Reserved, not paid (old site)';
      return 'Not paid yet';
    case 'confirmed':
      return 'Confirmed';
    case 'cancelled':
      return 'Cancelled';
    case 'completed':
      return 'Completed';
    case 'no-show':
      return 'No-show';
  }
}

export const STATUS_FILTER_LABEL: Record<BookingDoc['status'], string> = {
  'pending-payment': 'Not paid',
  confirmed: 'Confirmed',
  cancelled: 'Cancelled',
  completed: 'Completed',
  'no-show': 'No-show',
};

/** Badge colour for each status: orange needs doing, green is on, grey is over. */
export const STATUS_TONE: Record<BookingDoc['status'], BadgeTone> = {
  'pending-payment': 'buoy',
  confirmed: 'spring',
  cancelled: 'muted',
  completed: 'sand',
  'no-show': 'muted',
};

/** {@link STATUS_TONE}, with a closed booking still waiting on its customer in orange. */
export function statusTone(b: BookingDoc): BadgeTone {
  return awaitingMove(b) ? 'buoy' : STATUS_TONE[b.status];
}

/**
 * Why the site let go of an unpaid checkout by itself. Bookings it cancelled
 * before `cancelledBy: 'system'` existed were saved as `admin`.
 */
const AUTOMATIC_CANCELLATION_REASONS = new Set([
  'Checkout session expired',
  'Bank payment failed',
  'Stripe Checkout session creation failed',
]);

/** Who cancelled the booking, for its Cancellation card. */
export function cancelledByLabel(b: BookingDoc): string {
  if (b.cancelledBy === 'customer') return 'The customer';
  if (
    b.cancelledBy === 'system' ||
    (b.cancelledBy === 'admin' && AUTOMATIC_CANCELLATION_REASONS.has(b.cancellationReason ?? ''))
  ) {
    return 'The website (checkout never paid)';
  }
  if (b.cancelledBy === 'admin') return 'You';
  return '—';
}

/** What each bounced email is called, in plain English. Matches EMAIL_KIND_LABEL in functions/src/lib/email-log.ts. */
const EMAIL_KIND_LABEL: Record<string, string> = {
  confirmation: 'booking confirmation',
  cancellation: 'cancellation email',
  closureOffer: '“pick a new date” email',
  reminder: 'day-before reminder',
  followup: '“thanks for coming” email',
  reschedule: 'updated confirmation',
  rescheduleAck: '“we got your request” email',
  waiver: 'waiver link',
  waiverReminder: 'waiver reminder',
  weatherCancel: 'weather cancellation email',
};

export function emailKindLabel(kind: string): string {
  return EMAIL_KIND_LABEL[kind] ?? `${kind} email`;
}

/** Emails to the customer that bounced, oldest first. */
export function emailBounces(b: BookingDoc): Array<{ kind: string; label: string; to: string; permanent: boolean; message: string | null }> {
  return Object.entries(b.emailBounces ?? {})
    .sort(([, x], [, y]) => (x.at?.seconds ?? 0) - (y.at?.seconds ?? 0))
    .map(([kind, x]) => ({
      kind,
      label: emailKindLabel(kind),
      to: x.to,
      permanent: (x.bounceType ?? '').toLowerCase() === 'permanent',
      message: x.bounceMessage,
    }));
}

export function hasBouncedEmail(b: BookingDoc): boolean {
  return Object.keys(b.emailBounces ?? {}).length > 0;
}

export function paymentLabel(b: BookingDoc): string {
  switch (b.paymentStatus) {
    case 'paid':
      return 'Paid';
    case 'pending':
      return 'Not paid';
    case 'refunded':
      return 'Refunded';
    case 'partial-refund':
      return 'Partly refunded';
    case 'failed':
      return 'Payment failed';
    default:
      return b.paymentStatus;
  }
}

export function slotLabel(slot: string): string {
  return slotLabels[slot as TourTimeSlot] ?? slot;
}

/**
 * Departure as minutes after midnight, from the schedule (the sunset
 * cruise's moves with the sun, so it needs the date).
 */
export function departureMinutes(b: Pick<BookingDoc, 'timeSlot' | 'date'>): number {
  if (b.timeSlot in SLOT_MINUTES) return slotStartMinutes(b.timeSlot as TourTimeSlot, b.date);
  return slotOrder.indexOf(b.timeSlot as TourTimeSlot) * 120 + 8 * 60;
}

export function departureTime(b: Pick<BookingDoc, 'timeSlot' | 'date'>): string {
  return b.timeSlot in SLOT_MINUTES ? formatClock(departureMinutes(b)) : slotLabel(b.timeSlot);
}

/** "Tue, Oct 14" — or "Today" / "Tomorrow" on marina time. */
export function shortDate(iso: string, opts: { relative?: boolean; year?: boolean } = {}): string {
  if (opts.relative) {
    const today = marinaNow().date;
    if (iso === today) return 'Today';
    const t = parseIsoDate(today);
    if (t) {
      t.setDate(t.getDate() + 1);
      const y = t.getFullYear();
      const m = String(t.getMonth() + 1).padStart(2, '0');
      const d = String(t.getDate()).padStart(2, '0');
      if (iso === `${y}-${m}-${d}`) return 'Tomorrow';
    }
  }
  const d = parseIsoDate(iso);
  if (!d) return iso;
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(opts.year ? { year: 'numeric' } : {}),
  });
}

/** "4 guests", or a plain note when the old site didn't record party size. */
export function partySize(b: Pick<BookingDoc, 'guestCount'>): string {
  if (!b.guestCount) return 'party size not recorded';
  return `${b.guestCount} ${b.guestCount === 1 ? 'guest' : 'guests'}`;
}

export function typeLabel(type: BookingDoc['type']): string {
  return type === 'private' ? 'Private boat' : 'Shared boat';
}

/**
 * A trip that's going ahead: confirmed, or reserved on the old site (the
 * importer files those as pending-payment). Matches isGoingAhead in
 * functions/src/lib/types.ts.
 */
export function goingAhead(b: BookingDoc): boolean {
  return b.status === 'confirmed' || (b.status === 'pending-payment' && isLegacy(b));
}

/**
 * Booked on this site and not paid for yet: the checkout charges what it
 * was opened for, so the booking can't be edited or moved until it's paid.
 */
export function stillPaying(b: BookingDoc): boolean {
  return b.status === 'pending-payment' && !isLegacy(b);
}

/** True once the departure has left (marina time). */
export function departureLeft(b: Pick<BookingDoc, 'date' | 'timeSlot'>): boolean {
  const now = marinaNow();
  return b.date < now.date || (b.date === now.date && now.minutes >= departureMinutes(b));
}

/** True once the departure is back in (marina time): it left and its time out is up. */
export function departureBack(b: Pick<BookingDoc, 'date' | 'timeSlot'>): boolean {
  const now = marinaNow();
  const back = departureMinutes(b) + (SLOT_MINUTES[b.timeSlot as TourTimeSlot] ?? 120);
  return b.date < now.date || (b.date === now.date && now.minutes >= back);
}

/**
 * Completed / no-show can be marked: a trip going ahead whose departure has
 * left, and not one waiting on the customer's choice after a closure.
 * Completed waits until it's back ({@link canMarkCompleted}). Matches
 * adminMarkOne in functions/src/lib/admin-mark.ts, with one difference:
 * the server also marks a trip whose closure a reopen left behind (the day
 * is open again, isStaleClosure in functions/src/lib/close-day.ts). That
 * takes the blackouts and the closure's record, which this page doesn't
 * load, so here the buttons wait until settleClosedBookings takes such a
 * closure off (6 AM each day).
 */
export function canMarkAfterTour(b: BookingDoc): boolean {
  return goingAhead(b) && !awaitingMove(b) && departureLeft(b);
}

/**
 * Completed takes the trip off the boat, so only once it's back: marked
 * while a whole-day charter is still out, the rest of the day would go on
 * sale. A no-show can be marked as soon as it's left. Matches adminMarkOne.
 */
export function canMarkCompleted(b: BookingDoc): boolean {
  return canMarkAfterTour(b) && departureBack(b);
}

/**
 * "Email the confirmation again": it says the tour is on, so only for a
 * confirmed trip still to come that Travis hasn't closed. Matches
 * adminResendOne in functions/src/lib/admin-resend.ts.
 */
export function canResendConfirmation(b: BookingDoc): boolean {
  return b.status === 'confirmed' && !b.closure && b.date >= marinaNow().date;
}

/** Days a "thanks for coming" email can still go out after the tour (matches the server). */
export const FOLLOWUP_MAX_AGE_DAYS = 14;

/** The tour has happened, recently enough for a "thanks for coming" email. */
export function followupAllowed(b: Pick<BookingDoc, 'date' | 'status'>): boolean {
  if (b.status !== 'completed') return false;
  const today = marinaNow().date;
  const cutoff = new Date(`${today}T12:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - FOLLOWUP_MAX_AGE_DAYS);
  return b.date < today && b.date >= cutoff.toISOString().slice(0, 10);
}

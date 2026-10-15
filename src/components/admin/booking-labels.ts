// Plain-English wording for bookings, shared by the admin list, detail page
// and calendar so Travis sees the same words everywhere — never raw values
// like `pending-payment` or `partial-refund`.

import type { BookingDoc } from '@/lib/admin-firestore';
import { marinaNow } from '@/lib/availability';
import { parseIsoDate } from '@/lib/date';
import { slotLabels, slotOrder, tours, type TourTimeSlot } from '@/lib/tours';
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

/** Departure as minutes after midnight, from the booked tour (or its slot). */
export function departureMinutes(b: Pick<BookingDoc, 'tourId' | 'timeSlot'>): number {
  const tour = tours.find((t) => t.slug === b.tourId) ?? tours.find((t) => t.timeSlot === b.timeSlot);
  if (!tour) return slotOrder.indexOf(b.timeSlot as TourTimeSlot) * 120 + 8 * 60;
  const [h, m] = tour.startTime.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export function departureTime(b: Pick<BookingDoc, 'tourId' | 'timeSlot'>): string {
  const tour = tours.find((t) => t.slug === b.tourId) ?? tours.find((t) => t.timeSlot === b.timeSlot);
  return tour?.startTimeDisplay ?? slotLabel(b.timeSlot);
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

/** True on or after the tour's date (marina time). */
export function tourDayReached(b: Pick<BookingDoc, 'date'>): boolean {
  return b.date <= marinaNow().date;
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

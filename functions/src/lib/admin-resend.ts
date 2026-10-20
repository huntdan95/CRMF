import type { Firestore } from 'firebase-admin/firestore';

import { db as defaultDb } from './firebase';
import { closedDeparturesOn } from './close-day';
import { marinaNow } from './datetime';
import { resendBookingConfirmation } from './send-confirmation';
import type { Booking } from './types';

export type AdminResendOutcome =
  | { kind: 'sent' }
  | { kind: 'not-found' }
  | { kind: 'not-confirmed' }
  /**
   * Travis closed the departure: the customer has the "pick a new date"
   * email instead, or he left them booked to call them himself.
   */
  | { kind: 'closed' }
  /** The trip date has passed. */
  | { kind: 'past' };

/**
 * Admin's "Email the confirmation again", and MCP's
 * resend_confirmation_email. The email says the tour is confirmed and
 * locked in, so it only goes for a confirmed booking whose trip is still to
 * come, on a departure Travis hasn't closed. The same rules as "Fix email
 * and resend" (lib/fix-bounced-email.ts).
 */
export async function adminResendOne(
  bookingId: string,
  deps: { db?: Firestore; now?: Date; resend?: (bookingId: string) => Promise<void> } = {},
): Promise<AdminResendOutcome> {
  const db = deps.db ?? defaultDb;
  const resend = deps.resend ?? resendBookingConfirmation;
  const booking = (await db.collection('bookings').doc(bookingId).get()).data() as Booking | undefined;
  if (!booking) return { kind: 'not-found' };
  // sendBookingConfirmation quietly skips anything else; say so instead of
  // reporting an email that never went out.
  if (booking.status !== 'confirmed') return { kind: 'not-confirmed' };
  if (booking.closure) return { kind: 'closed' };
  if (booking.date < marinaNow(deps.now).date) return { kind: 'past' };
  // Closed and left booked (or closed from MCP): "locked in" would tell
  // them it's going ahead.
  if ((await closedDeparturesOn(db, booking.date))(booking.timeSlot)) return { kind: 'closed' };

  // Clears the sent-marker so sendBookingConfirmation will re-send.
  await resend(bookingId);
  return { kind: 'sent' };
}

import type { Firestore } from 'firebase-admin/firestore';

import { db as defaultDb, FieldValue } from './firebase';
import { hoursUntilTour } from './datetime';
import { slotStartTime } from './schedule';
import { isGoingAhead, type Booking } from './types';

export type AdminMarkOutcome =
  | { kind: 'marked' }
  | { kind: 'not-found' }
  /** Cancelled, marked already, or a checkout that was never paid. */
  | { kind: 'not-going-ahead'; status: Booking['status'] }
  /** Travis closed the departure and the customer hasn't picked a new date or a refund yet. */
  | { kind: 'closed' }
  /** The departure hasn't left yet, marina time. */
  | { kind: 'not-yet' };

/**
 * Travis marking a trip completed, or the customer a no-show, from admin or
 * MCP.
 *
 * There's no undo, and either one takes the booking off the boat: its seats
 * go back on sale and the trip drops off the crew's schedule. So only a
 * trip that's going ahead ({@link isGoingAhead}: confirmed, or reserved on
 * the old site) can be marked, and only once its departure has left. Not
 * one waiting on a closure either: the customer is still owed a new date or
 * a refund, and once it's marked the refund promised if they don't choose
 * never happens.
 *
 * Read and written in one transaction, so a closure or a cancel landing
 * meanwhile isn't written over.
 */
export async function adminMarkOne(
  bookingId: string,
  status: 'completed' | 'no-show',
  deps: { db?: Firestore; now?: Date } = {},
): Promise<AdminMarkOutcome> {
  const db = deps.db ?? defaultDb;
  const now = deps.now ?? new Date();
  const ref = db.collection('bookings').doc(bookingId);

  return db.runTransaction<AdminMarkOutcome>(async (tx) => {
    const data = (await tx.get(ref)).data() as Booking | undefined;
    if (!data) return { kind: 'not-found' };
    const booking = { ...data, id: bookingId };
    if (!isGoingAhead(booking)) return { kind: 'not-going-ahead', status: booking.status };
    if (booking.closure) return { kind: 'closed' };
    if (hoursUntilTour(booking.date, slotStartTime(booking.timeSlot, booking.date), now) > 0) {
      return { kind: 'not-yet' };
    }

    tx.update(ref, { status, updatedAt: FieldValue.serverTimestamp() });
    return { kind: 'marked' };
  });
}

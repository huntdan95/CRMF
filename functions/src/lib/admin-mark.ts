import type { Firestore } from 'firebase-admin/firestore';

import { db as defaultDb, FieldValue } from './firebase';
import { closesSlot, isStaleClosure } from './close-day';
import { hoursUntilTour, marinaNow } from './datetime';
import { SLOT_MINUTES, slotStartTime } from './schedule';
import { isGoingAhead, type Blackout, type Booking } from './types';

export type AdminMarkOutcome =
  | { kind: 'marked' }
  | { kind: 'not-found' }
  /** Cancelled, marked already, or a checkout that was never paid. */
  | { kind: 'not-going-ahead'; status: Booking['status'] }
  /** Travis closed the departure and the customer hasn't picked a new date or a refund yet. */
  | { kind: 'closed' }
  /** Travis closed the departure and left them booked on it (or closed it from MCP). */
  | { kind: 'departure-closed' }
  /** The departure hasn't left yet, marina time. */
  | { kind: 'not-yet' }
  /** Completed while the trip is still out: it would free the boat before it's back. */
  | { kind: 'not-back' };

/**
 * Travis marking a trip completed, or the customer a no-show, from admin or
 * MCP.
 *
 * There's no undo, and either one takes the booking off the boat: its seats
 * go back on sale and the trip drops off the crew's schedule. So only a
 * trip that's going ahead ({@link isGoingAhead}: confirmed, or reserved on
 * the old site) can be marked, and a no-show only once its departure has
 * left (the party didn't come, so the boat really is free). Completed waits
 * until the trip is back: marked while a whole-day charter is still out,
 * the rest of the day would go on sale with the boat away. Not one waiting
 * on a closure either: the customer is still owed a new date or a refund,
 * and once it's marked the refund promised if they don't choose never
 * happens. Unless a reopen under the previous version left that closure
 * behind (isStaleClosure): the day is open again and the trip may have gone
 * ahead with them on it, which that version let Travis mark. Marking one
 * takes the closure off, with a note, so nothing refunds them or offers
 * them a new date afterwards. Nor one with no closure on a departure a
 * blackout still covers (closedDeparturesOn: he left them booked, closed
 * it from MCP, or they paid after it closed). That trip didn't go out and
 * he owes them a new date or their money back, which he gives by moving or
 * cancelling it, after its date too. Once marked it can't be moved or
 * cancelled, so the money would be stuck.
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
    if (booking.closure && !(await isStaleClosure(db, booking, tx))) return { kind: 'closed' };
    if (!booking.closure) {
      const onDay = await tx.get(db.collection('blackouts').where('date', '==', booking.date));
      if (onDay.docs.some((d) => closesSlot((d.data() as Blackout).affectedSlots, booking.timeSlot))) {
        return { kind: 'departure-closed' };
      }
    }
    const hours = hoursUntilTour(booking.date, slotStartTime(booking.timeSlot, booking.date), now);
    if (hours > 0) return { kind: 'not-yet' };
    if (status === 'completed' && hours > -SLOT_MINUTES[booking.timeSlot] / 60) return { kind: 'not-back' };

    if (!booking.closure) {
      tx.update(ref, { status, updatedAt: FieldValue.serverTimestamp() });
      return { kind: 'marked' };
    }
    const note = `${marinaNow(now).date}: Marked ${status === 'completed' ? 'completed' : 'a no-show'} after the day was reopened, so the offer of a new date or a refund (${booking.closure.reason.toLowerCase()}) no longer applies.`;
    tx.update(ref, {
      status,
      closure: FieldValue.delete(),
      adminNotes: booking.adminNotes ? `${booking.adminNotes}\n${note}` : note,
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { kind: 'marked' };
  });
}

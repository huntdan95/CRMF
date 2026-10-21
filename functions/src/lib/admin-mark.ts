import type { Firestore } from 'firebase-admin/firestore';

import { db as defaultDb, FieldValue } from './firebase';
import { closesSlot, isStaleClosure } from './close-day';
import { hoursUntilTour, marinaNow } from './datetime';
import { SLOT_MINUTES, slotStartTime } from './schedule';
import { isGoingAhead, type Blackout, type Booking, type ClosureAction } from './types';

export type AdminMarkOutcome =
  /** `closedBy`: the blackouts it was marked despite (`ranAnyway`). */
  | { kind: 'marked'; closedBy?: string[] }
  | { kind: 'not-found' }
  /** Cancelled, marked already, or a checkout that was never paid. */
  | { kind: 'not-going-ahead'; status: Booking['status'] }
  /** Travis closed the departure and the customer hasn't picked a new date or a refund yet. */
  | { kind: 'closed' }
  /** Travis closed the departure and left them booked on it (or closed it from MCP). */
  | { kind: 'departure-closed' }
  /** `ranAnyway`, but a closure of the departure is still in its undo window or going out. */
  | { kind: 'closing' }
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
 * Unless it went out after all (the weather cleared): the admin booking
 * page asks him to confirm that and sends `ranAnyway`, which marks it once
 * it has left, with a note. Not by reopening the day: a blackout comes
 * down as a whole, so every other trip it closed would count as having
 * run too (review requests, no Move or Cancel). Marked this way, this trip
 * alone counts: what goes out after a trip goes to a completed booking on
 * a closed departure (onOpenDepartures), and the day stays closed. Not
 * while a closure of it is in its undo window or going out (`closing`),
 * which may yet cancel them or offer them a new date.
 *
 * Read and written in one transaction, so a closure or a cancel landing
 * meanwhile isn't written over.
 */
export async function adminMarkOne(
  bookingId: string,
  status: 'completed' | 'no-show',
  deps: { db?: Firestore; now?: Date; ranAnyway?: boolean } = {},
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
    let closedBy: string[] = [];
    if (!booking.closure) {
      const onDay = await tx.get(db.collection('blackouts').where('date', '==', booking.date));
      closedBy = onDay.docs.filter((d) => closesSlot((d.data() as Blackout).affectedSlots, booking.timeSlot)).map((d) => d.id);
      if (closedBy.length > 0 && !deps.ranAnyway) return { kind: 'departure-closed' };
      // A closed day's action has the blackout's id; one closed from MCP has none.
      const actions = await Promise.all(closedBy.map((id) => tx.get(db.collection('closureActions').doc(id))));
      const states = actions.map((a) => (a.data() as ClosureAction | undefined)?.state);
      if (states.some((s) => s === 'pending' || s === 'finalizing')) return { kind: 'closing' };
    }
    const hours = hoursUntilTour(booking.date, slotStartTime(booking.timeSlot, booking.date), now);
    if (hours > 0) return { kind: 'not-yet' };
    if (status === 'completed' && hours > -SLOT_MINUTES[booking.timeSlot] / 60) return { kind: 'not-back' };

    const marked = status === 'completed' ? 'completed' : 'a no-show';
    if (closedBy.length > 0) {
      const note = `${marinaNow(now).date}: Marked ${marked}: the trip went out after all, though you closed it.`;
      tx.update(ref, { status, adminNotes: booking.adminNotes ? `${booking.adminNotes}\n${note}` : note, updatedAt: FieldValue.serverTimestamp() });
      return { kind: 'marked', closedBy };
    }
    if (!booking.closure) {
      tx.update(ref, { status, updatedAt: FieldValue.serverTimestamp() });
      return { kind: 'marked' };
    }
    const note = `${marinaNow(now).date}: Marked ${marked} after the day was reopened, so the offer of a new date or a refund (${booking.closure.reason.toLowerCase()}) no longer applies.`;
    tx.update(ref, {
      status,
      closure: FieldValue.delete(),
      adminNotes: booking.adminNotes ? `${booking.adminNotes}\n${note}` : note,
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { kind: 'marked' };
  });
}

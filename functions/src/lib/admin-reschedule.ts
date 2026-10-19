import type { Firestore } from 'firebase-admin/firestore';

import { db as defaultDb, FieldValue } from './firebase';
import { AvailabilityError, assertSeatsAvailable, type AvailabilityReason } from './availability';
import { hoursUntilTour, isRealDate, marinaNow } from './datetime';
import { slotRunsOn, slotStartTime } from './schedule';
import { getTourBySlug } from './tours';
import type { Blackout, Booking, Tour } from './types';

export type AdminRescheduleOutcome =
  | {
      kind: 'moved';
      /** Where it was, for the audit log. */
      before: Pick<Booking, 'date' | 'timeSlot' | 'tourId' | 'tourName' | 'type'>;
      /** The booking as it is now. */
      booking: Booking;
    }
  | { kind: 'invalid-date' }
  | { kind: 'past' }
  | { kind: 'not-found' }
  | { kind: 'not-active' }
  /** Imported from the old site with no party size, so its seats can't be counted. */
  | { kind: 'no-party-size' }
  | { kind: 'tour-missing' }
  /** Cancelled or moved by someone else while this was saving. */
  | { kind: 'changed' }
  | { kind: 'unavailable'; reason: AvailabilityReason; message: string };

const isActive = (b: Booking) => b.status === 'pending-payment' || b.status === 'confirmed';

/**
 * Travis moving a booking to another date or tour, from admin or MCP.
 *
 * The new departure gets the same seat rules as a booking made online
 * ({@link assertSeatsAvailable}), with this booking left out of the count,
 * so a move can't oversell the boat or land on a closed departure. Unlike
 * online booking, any departure that hasn't left yet will do: Travis can
 * put someone on the next trip out, or further ahead than the website goes.
 *
 * The seat check and the write are one transaction that reads the booking
 * again. If it was cancelled or moved in the meantime (the customer picking
 * a new date for a day Travis closed, say), nothing changes.
 */
export async function adminRescheduleOne(
  bookingId: string,
  input: { newDate: string; newTourSlug: string },
  deps: {
    db?: Firestore;
    getTour?: (slug: string) => Promise<Tour | null>;
    now?: Date;
  } = {},
): Promise<AdminRescheduleOutcome> {
  const { db = defaultDb, getTour = getTourBySlug } = deps;
  const now = deps.now ?? new Date();
  const { newDate, newTourSlug } = input;
  if (!isRealDate(newDate)) return { kind: 'invalid-date' };
  if (newDate < marinaNow(now).date) return { kind: 'past' };

  const ref = db.collection('bookings').doc(bookingId);
  const booking = (await ref.get()).data() as Booking | undefined;
  if (!booking) return { kind: 'not-found' };
  if (!isActive(booking)) return { kind: 'not-active' };
  // Its seats can't be counted, so it could be moved onto a full boat.
  if (booking.guestCount < 1) return { kind: 'no-party-size' };
  const newTour = await getTour(newTourSlug);
  if (!newTour) return { kind: 'tour-missing' };

  try {
    if (!slotRunsOn(newTour.timeSlot, newDate)) {
      throw new AvailabilityError('out-of-season', `The ${newTour.timeSlot} departure doesn't run on ${newDate}.`);
    }
    // Moving onto a trip that's gone would email a confirmation for it.
    const departs = slotStartTime(newTour.timeSlot, newDate);
    if (hoursUntilTour(newDate, departs, now) <= 0) {
      throw new AvailabilityError('departed', `The ${departs} departure on ${newDate} has already left.`);
    }

    const moved = await db.runTransaction(async (tx) => {
      const [fresh, onDay, blackouts] = await Promise.all([
        tx.get(ref),
        tx.get(db.collection('bookings').where('date', '==', newDate)),
        tx.get(db.collection('blackouts').where('date', '==', newDate)),
      ]);
      const current = fresh.data() as Booking | undefined;
      if (!current || !isActive(current) || current.date !== booking.date || current.timeSlot !== booking.timeSlot) {
        return null;
      }
      assertSeatsAvailable({
        tour: newTour,
        date: newDate,
        guestCount: current.guestCount,
        bookings: onDay.docs.filter((d) => d.id !== bookingId).map((d) => d.data() as Booking),
        blackouts: blackouts.docs.map((d) => d.data() as Blackout),
      });
      const update = {
        date: newDate,
        timeSlot: newTour.timeSlot,
        tourId: newTour.slug,
        tourName: newTour.name,
        type: newTour.type,
      };
      tx.update(ref, {
        ...update,
        // A booking on a day Travis closed is settled by moving it: it
        // no longer waits on the customer or gets refunded later.
        closure: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      const after: Booking = { ...current, ...update, id: bookingId };
      delete after.closure;
      const { date, timeSlot, tourId, tourName, type } = current;
      return { before: { date, timeSlot, tourId, tourName, type }, booking: after };
    });
    return moved ? { kind: 'moved', ...moved } : { kind: 'changed' };
  } catch (err) {
    if (err instanceof AvailabilityError) return { kind: 'unavailable', reason: err.reason, message: err.message };
    throw err;
  }
}

import type { Firestore } from 'firebase-admin/firestore';

import { db as defaultDb, FieldValue } from './firebase';
import { getTourBySlug } from './tours';
import type { Booking, Tour } from './types';

/** The booking fields Travis can change from the Edit booking window. */
export const EDITABLE_FIELDS = [
  'guestCount',
  'guests',
  'customerName',
  'customerEmail',
  'customerPhone',
  'emergencyContactName',
  'emergencyContactPhone',
] as const;

export type BookingEdit = Partial<Pick<Booking, (typeof EDITABLE_FIELDS)[number]>>;

export type AdminEditOutcome =
  | { kind: 'updated'; before: Record<string, unknown>; after: Record<string, unknown> }
  | { kind: 'nothing-to-update' }
  | { kind: 'not-found' }
  | { kind: 'tour-missing' }
  | { kind: 'slot-full'; message: string };

/**
 * Travis changing a booking's party size or contact details.
 *
 * Raising the guest count on a shared tour needs free seats on that boat.
 * The seat check and the write are one transaction, so a booking made
 * while this is saved can't fill the same seats: Firestore re-runs the
 * check if any booking on that day changes before the write lands.
 */
export async function adminEditOne(
  bookingId: string,
  edit: BookingEdit,
  deps: {
    db?: Firestore;
    getTour?: (slug: string) => Promise<Tour | null>;
  } = {},
): Promise<AdminEditOutcome> {
  const { db = defaultDb, getTour = getTourBySlug } = deps;
  const ref = db.collection('bookings').doc(bookingId);

  const changes: Record<string, unknown> = {};
  for (const key of EDITABLE_FIELDS) {
    if (edit[key] !== undefined) changes[key] = edit[key];
  }
  if (Object.keys(changes).length === 0) return { kind: 'nothing-to-update' };

  return db.runTransaction<AdminEditOutcome>(async (tx) => {
    const booking = (await tx.get(ref)).data() as Booking | undefined;
    if (!booking) return { kind: 'not-found' };

    const active = booking.status === 'pending-payment' || booking.status === 'confirmed';
    const newCount = edit.guestCount;
    if (active && booking.type === 'shared' && newCount !== undefined && newCount > booking.guestCount) {
      const tour = await getTour(booking.tourId);
      if (!tour) return { kind: 'tour-missing' };
      const sameDay = await tx.get(db.collection('bookings').where('date', '==', booking.date));
      const used = sameDay.docs
        .map((d) => d.data() as Booking)
        .filter(
          (b) =>
            b.id !== bookingId &&
            b.timeSlot === booking.timeSlot &&
            (b.status === 'pending-payment' || b.status === 'confirmed'),
        )
        .reduce((s, b) => s + b.guestCount, 0);
      if (used + newCount > tour.maxGuests) {
        return {
          kind: 'slot-full',
          message: `Cannot raise to ${newCount} — only ${Math.max(0, tour.maxGuests - used)} spots free in this slot.`,
        };
      }
    }

    const before: Record<string, unknown> = {};
    for (const key of Object.keys(changes)) before[key] = booking[key as keyof Booking];
    const after = { ...changes, updatedAt: FieldValue.serverTimestamp() };
    tx.update(ref, after);
    return { kind: 'updated', before, after };
  });
}

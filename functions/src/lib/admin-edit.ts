import type { Firestore } from 'firebase-admin/firestore';

import { db as defaultDb, FieldValue } from './firebase';
import { AvailabilityError, assertSeatsAvailable } from './availability';
import { sameAddress } from './email-events';
import { getTourBySlug } from './tours';
import { isLegacyBooking, type Booking, type Tour } from './types';

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
  /** Booked on this site and still being paid for: the checkout charges what it was opened for. */
  | { kind: 'still-paying' }
  | { kind: 'tour-missing' }
  | { kind: 'slot-full'; message: string };

/**
 * Travis changing a booking's party size or contact details.
 *
 * Raising the guest count on a shared tour needs free seats on that boat.
 * The seat check and the write are one transaction, so a booking made
 * while this is saved can't fill the same seats: Firestore re-runs the
 * check if any booking on that day changes before the write lands.
 *
 * A booking whose online payment hasn't gone through can't be changed:
 * the customer would pay the old price, and the payment then confirms the
 * booking as it stands.
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
  // Lowercased, as checkout and the importer save it, so MCP's
  // list_bookings finds the booking by its address.
  if (edit.customerEmail !== undefined) changes.customerEmail = edit.customerEmail.trim().toLowerCase();
  if (Object.keys(changes).length === 0) return { kind: 'nothing-to-update' };

  return db.runTransaction<AdminEditOutcome>(async (tx) => {
    const booking = (await tx.get(ref)).data() as Booking | undefined;
    if (!booking) return { kind: 'not-found' };
    if (booking.status === 'pending-payment' && !isLegacyBooking({ ...booking, id: bookingId })) {
      return { kind: 'still-paying' };
    }

    const active = booking.status === 'pending-payment' || booking.status === 'confirmed';
    const newCount = edit.guestCount;
    if (active && booking.type === 'shared' && newCount !== undefined && newCount > booking.guestCount) {
      const tour = await getTour(booking.tourId);
      if (!tour) return { kind: 'tour-missing' };
      // One imported with no party size already holds the whole boat (the
      // seat count fills it), so recording its size never takes more seats.
      const held = booking.guestCount >= 1 ? booking.guestCount : tour.maxGuests;
      if (newCount > held) {
        const sameDay = await tx.get(db.collection('bookings').where('date', '==', booking.date));
        // The seat rules online booking uses, this booking left out, so one
        // imported with no party size fills the boat. Only its own departure
        // counts: the booking already holds it, so a blackout or a booked
        // overlapping departure since is for Travis to sort out, not a
        // reason he can't record a bigger party.
        try {
          assertSeatsAvailable({
            tour: { timeSlot: booking.timeSlot, type: booking.type, maxGuests: tour.maxGuests },
            date: booking.date,
            guestCount: newCount,
            bookings: sameDay.docs
              .filter((d) => d.id !== bookingId)
              .map((d) => d.data() as Booking)
              .filter((b) => b.timeSlot === booking.timeSlot),
            blackouts: [],
          });
        } catch (err) {
          if (err instanceof AvailabilityError) {
            return { kind: 'slot-full', message: `Cannot raise to ${newCount}. ${err.message}` };
          }
          throw err;
        }
      }
    }

    const before: Record<string, unknown> = {};
    for (const key of Object.keys(changes)) before[key] = booking[key as keyof Booking];
    const after = { ...changes, updatedAt: FieldValue.serverTimestamp() };

    // A new address: every alert so far was about the old one (a delayed
    // email alerts without flagging a bounce), so all the markers go and
    // Travis hears if the new address has trouble too. The bounces stay:
    // they're what "Fix email and resend" sends again, to this address.
    const clearBounces: Record<string, unknown> = {};
    if (edit.customerEmail !== undefined && !sameAddress(edit.customerEmail, booking.customerEmail)) {
      clearBounces.bounceAlertSentAt = FieldValue.delete();
      clearBounces.bounceAlertClaims = FieldValue.delete();
    }

    tx.update(ref, { ...after, ...clearBounces });
    return { kind: 'updated', before, after };
  });
}

/**
 * Most one save from admin or MCP can add to the private notes: what
 * Travis types, a line or an edit. Not a cap on the notes themselves: the
 * site adds lines of its own (a refund to make by hand, a trip put back
 * on, a customer moving), and an old-site import brings that site's notes,
 * so they can grow past this and must still be editable.
 */
export const NOTE_MAX = 2000;

export type AdminNoteOutcome =
  | { kind: 'saved'; before: string | undefined; after: string }
  | { kind: 'not-found' }
  /** The notes aren't what the caller started from any more. */
  | { kind: 'changed' }
  /** The save would add more than {@link NOTE_MAX} characters to the notes. */
  | { kind: 'too-long'; added: number };

/**
 * Travis's private notes on a booking. The site adds lines of its own (a
 * refund to make by hand, a customer moving off a day Travis closed), so a
 * save mustn't quietly drop one that landed while the notes were open:
 *  - `append` adds a line to the notes as they are when it saves (MCP's
 *    add_booking_note);
 *  - `previousNotes` is the text the admin note window started from, and
 *    the save is refused if the notes have changed since.
 * `note` without `previousNotes` replaces the notes, as callers from before
 * these existed expect.
 */
export async function saveAdminNote(
  bookingId: string,
  input: { note: string; previousNotes?: string } | { append: string },
  deps: { db?: Firestore } = {},
): Promise<AdminNoteOutcome> {
  const db = deps.db ?? defaultDb;
  const ref = db.collection('bookings').doc(bookingId);

  return db.runTransaction<AdminNoteOutcome>(async (tx) => {
    const booking = (await tx.get(ref)).data() as Booking | undefined;
    if (!booking) return { kind: 'not-found' };
    const current = booking.adminNotes ?? '';

    let after: string;
    if ('append' in input) {
      // The line is what's typed, capped by the caller; the notes it goes on aren't.
      const existing = current.trim();
      after = existing ? `${existing}\n${input.append}` : input.append;
    } else {
      if (input.previousNotes !== undefined && input.previousNotes !== current) return { kind: 'changed' };
      after = input.note;
      // What this save adds, however long the notes already were.
      const added = after.length - current.length;
      if (added > NOTE_MAX) return { kind: 'too-long', added };
    }

    tx.update(ref, { adminNotes: after, updatedAt: FieldValue.serverTimestamp() });
    return { kind: 'saved', before: booking.adminNotes, after };
  });
}

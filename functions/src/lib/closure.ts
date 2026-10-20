import type { Firestore } from 'firebase-admin/firestore';

import { db as defaultDb, FieldValue } from './firebase';
import { AvailabilityError, assertBookingWindow, assertSeatsAvailable } from './availability';
import { addDays, marinaNow } from './datetime';
import { salesTaxOn, totalOn, type SeasonRates } from './pricing';
import { formatPrice } from './tours';
import { isLegacyBooking, type Blackout, type Booking, type Tour } from './types';

/**
 * When Travis closes a departure, he can offer the people booked on it
 * another date or a full refund instead of cancelling them outright. They
 * choose on their booking page; whoever hasn't by `decideBy` (this many
 * days after the closed date) is cancelled and refunded in full.
 */
export const CLOSURE_DECIDE_DAYS = 3;

export function closureDecideBy(closedDate: string, today: string): string {
  return addDays(closedDate > today ? closedDate : today, CLOSURE_DECIDE_DAYS);
}

/**
 * Bookings that get the offer. A checkout still in progress on this site
 * hasn't paid for anything, so it's cancelled as before. Old-site bookings
 * are offered whatever their payment state: Travis took those by hand.
 */
export function canOfferMove(b: Pick<Booking, 'id' | 'legacy' | 'status'>): boolean {
  return b.status === 'confirmed' || (b.status === 'pending-payment' && isLegacyBooking(b));
}

/** Still waiting on the customer's choice. */
export function awaitingMove(b: Pick<Booking, 'status' | 'closure'>): boolean {
  return !!b.closure && (b.status === 'confirmed' || b.status === 'pending-payment');
}

/**
 * Marks a booking as closed and waiting on the customer, unless it stopped
 * being active since the caller looked. Returns the booking as it was, or
 * null if it wasn't marked. A second closure (Travis closing the rest of
 * the day, say) replaces the first.
 *
 * `expected` is the departure the caller found it on. If it has moved off
 * it since (Travis or the customer rescheduled it), it isn't marked either:
 * the closure doesn't cover where it is now.
 */
export async function markClosed(
  bookingId: string,
  closure: { blackoutId: string; reason: string; decideBy: string },
  deps: { db?: Firestore } = {},
  expected?: Pick<Booking, 'date' | 'timeSlot'>,
): Promise<Booking | null> {
  const db = deps.db ?? defaultDb;
  const ref = db.collection('bookings').doc(bookingId);
  return db.runTransaction(async (tx) => {
    const fresh = (await tx.get(ref)).data() as Booking | undefined;
    if (!fresh || !canOfferMove({ ...fresh, id: bookingId })) return null;
    if (expected && (fresh.date !== expected.date || fresh.timeSlot !== expected.timeSlot)) return null;
    tx.update(ref, {
      closure: { ...closure, offeredAt: FieldValue.serverTimestamp() },
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { ...fresh, id: bookingId };
  });
}

export type MoveOutcome =
  | { kind: 'moved'; booking: Booking }
  | { kind: 'not-found' }
  | { kind: 'bad-token' }
  /** Not waiting on a move: never closed, already moved, or cancelled. */
  | { kind: 'not-closed' }
  /** Past `decideBy`: it's being refunded. */
  | { kind: 'expired' }
  /** The customer can't make this move online; `message` says why. */
  | { kind: 'not-allowed'; message: string }
  | { kind: 'unavailable'; message: string };

export interface MoveDeps {
  db?: Firestore;
  now?: Date;
  getTour: (slug: string) => Promise<Tour | null>;
  getSeasons: (date: string) => Promise<SeasonRates[]>;
}

/** Same type of trip: shared seats, a 2-hour private boat, the all-day charter, or the sunset cruise. */
function sameKind(a: Pick<Tour, 'type' | 'timeSlot'>, b: Pick<Booking, 'type' | 'timeSlot'>): boolean {
  return (
    a.type === b.type &&
    (a.timeSlot === 'whole-day') === (b.timeSlot === 'whole-day') &&
    (a.timeSlot === 'sunset') === (b.timeSlot === 'sunset')
  );
}

/**
 * The customer moving a booking Travis closed to another open departure of
 * the same kind, at no charge. Not into one priced higher than what was
 * closed (a holiday rate, say): Travis sorts those out by phone.
 */
export async function moveClosedBooking(
  input: { bookingId: string; accessToken: string; newDate: string; newTourSlug: string },
  deps: MoveDeps,
): Promise<MoveOutcome> {
  const db = deps.db ?? defaultDb;
  const now = marinaNow(deps.now);
  const ref = db.collection('bookings').doc(input.bookingId);
  const snap = await ref.get();
  if (!snap.exists) return { kind: 'not-found' };
  const booking = { ...(snap.data() as Booking), id: input.bookingId };
  if (booking.accessToken !== input.accessToken) return { kind: 'bad-token' };
  if (!awaitingMove(booking)) return { kind: 'not-closed' };
  if (booking.closure!.decideBy < now.date) return { kind: 'expired' };

  const callTravis = 'Call or text Travis and he’ll sort it out.';
  const newTour = await deps.getTour(input.newTourSlug);
  if (!newTour || !newTour.active) {
    return { kind: 'not-allowed', message: `That tour isn’t taking bookings. ${callTravis}` };
  }
  if (!sameKind(newTour, booking)) {
    return { kind: 'not-allowed', message: `Pick the same kind of tour you booked. To switch, ${callTravis.toLowerCase()}` };
  }
  if (input.newDate === booking.date && newTour.timeSlot === booking.timeSlot) {
    return { kind: 'not-allowed', message: 'That’s the departure that was closed. Pick another one.' };
  }
  // The old site didn't always record party size; seats can't be counted.
  if (booking.type === 'shared' && booking.guestCount < 1) {
    return { kind: 'not-allowed', message: `We don’t have your party size on file. ${callTravis}` };
  }

  const guests = Math.max(1, booking.guestCount);
  const oldTour = (await deps.getTour(booking.tourId)) ?? newTour;
  const [oldSeasons, newSeasons] = await Promise.all([deps.getSeasons(booking.date), deps.getSeasons(input.newDate)]);
  const was = totalOn(oldTour, guests, booking.date, oldSeasons);
  const wouldBe = totalOn(newTour, guests, input.newDate, newSeasons);
  if (wouldBe > was) {
    // With the tax, as their booking page shows what they paid.
    const withTax = (cents: number) => formatPrice(cents + salesTaxOn(cents));
    return {
      kind: 'not-allowed',
      message: `That date is priced higher (${withTax(wouldBe)} with tax, against ${withTax(was)}). Pick another, or ${callTravis.toLowerCase()}`,
    };
  }

  try {
    assertBookingWindow({ tour: newTour, date: input.newDate, now });
    const moved = await db.runTransaction(async (tx) => {
      const [fresh, onDay, blackouts] = await Promise.all([
        tx.get(ref),
        tx.get(db.collection('bookings').where('date', '==', input.newDate)),
        tx.get(db.collection('blackouts').where('date', '==', input.newDate)),
      ]);
      const current = fresh.data() as Booking | undefined;
      // Moved, cancelled or refunded in another tab since we looked.
      if (!current || !awaitingMove(current) || current.date !== booking.date || current.timeSlot !== booking.timeSlot) {
        return null;
      }
      assertSeatsAvailable({
        tour: newTour,
        date: input.newDate,
        guestCount: guests,
        bookings: onDay.docs.filter((d) => d.id !== input.bookingId).map((d) => d.data() as Booking),
        blackouts: blackouts.docs.map((d) => d.data() as Blackout),
      });
      const note = `${now.date}: Moved by the customer from ${booking.date} (${booking.timeSlot}, ${current.closure!.reason.toLowerCase()}) to ${input.newDate} (${newTour.timeSlot}).`;
      const update = {
        date: input.newDate,
        timeSlot: newTour.timeSlot,
        tourId: newTour.slug,
        tourName: newTour.name,
        type: newTour.type,
        adminNotes: current.adminNotes ? `${current.adminNotes}\n${note}` : note,
      };
      tx.update(ref, {
        ...update,
        closure: FieldValue.delete(),
        // Put back on a trip Travis reopened and then closed again, it may
        // still carry the earlier offer's full-refund grace. That was for
        // the trip he reopened, not this one: the new trip is under the
        // usual policy, as when Travis moves it (lib/admin-reschedule.ts).
        refundGraceUntil: FieldValue.delete(),
        // The new trip gets its own trip prep and directions, as when
        // Travis moves it: the closed one's have usually gone out already.
        prepSentAt: null,
        directionsSentAt: null,
        updatedAt: FieldValue.serverTimestamp(),
      });
      const after: Booking = { ...current, ...update, id: input.bookingId };
      delete after.closure;
      delete after.refundGraceUntil;
      return after;
    });
    return moved ? { kind: 'moved', booking: moved } : { kind: 'not-closed' };
  } catch (err) {
    if (err instanceof AvailabilityError) {
      return { kind: 'unavailable', message: unavailableMessage(err) };
    }
    throw err;
  }
}

/** The availability rules' messages are written for Travis; these are for guests. */
function unavailableMessage(err: AvailabilityError): string {
  switch (err.reason) {
    case 'departed':
      return 'That departure has left or leaves within the hour. Pick a later one.';
    case 'too-far-ahead':
      return 'That’s further out than we take bookings. Pick an earlier date.';
    case 'blackout-day':
    case 'blackout-slot':
      return 'That departure isn’t running. Pick another one.';
    case 'slot-shared-full':
      return 'There aren’t enough seats left on that one. Pick another departure.';
    default:
      return 'That departure was just booked. Pick another one.';
  }
}

import type { TourTimeSlot } from './firebase/types';
import type { ClosureResult } from './closure-types';

/*
 * Whether a departure Travis closed is going out, for the crew app and the
 * admin dashboard. A blackout only stops new bookings; what happened to the
 * people already booked is on the closure action (functions/src/lib/close-day.ts):
 *
 *  - `closing`: he just closed it and the undo window is still open.
 *  - `cancelled`: they were cancelled, or asked to pick a new date.
 *  - `closed-booked`: he left them booked to contact them himself (or
 *    closed it from MCP, which never touches bookings): it may still run.
 *
 * Plain rules on rows already read, so admin pages reading Firestore in the
 * browser (Admin → Crew) go by them too. The server reads the rows with
 * fetchClosedDays in src/lib/closed-departures.ts.
 */

export type DepartureOff =
  | { kind: 'closing'; reason: string | null }
  | { kind: 'cancelled'; reason: string | null }
  | { kind: 'closed-booked'; reason: string | null };

export interface BlackoutRow {
  id: string;
  date: string;
  affectedSlots: string[];
  reason?: string | null;
  /**
   * A day closed from MCP (no closure action): its "Closed" alert to the
   * crew, with whom it left booked (functions/src/lib/close-day.ts,
   * alertCrewOnce).
   */
  crewAlert?: { kept?: Array<{ id: string; timeSlot: TourTimeSlot; guests: number }> } | null;
}

export interface ClosureRow {
  id: string;
  date: string;
  state: 'pending' | 'finalizing' | 'done' | 'undone';
  choice: 'offer' | 'cancel' | 'keep';
  reason: string | null;
  result?: ClosureResult;
}

/** Same as closesSlot in functions/src/lib/close-day.ts. */
const WHOLE_DAY_OVERLAPS: string[] = ['morning', 'mid-morning', 'early-afternoon'];
export function blackoutCovers(affected: string[], slot: string): boolean {
  if (affected.includes('all') || affected.includes(slot)) return true;
  return slot === 'whole-day' && affected.some((s) => WHOLE_DAY_OVERLAPS.includes(s));
}

export interface ClosedDays {
  blackouts: BlackoutRow[];
  actions: Map<string, ClosureRow>;
}

/**
 * Where a departure stands. `live`: bookings on it that weren't asked to
 * move. `moving`: bookings waiting to pick a new date.
 */
export function departureOff(
  date: string,
  slot: TourTimeSlot,
  counts: { live: number; moving: number },
  closed: ClosedDays,
): DepartureOff | null {
  const covering = closed.blackouts.filter((b) => b.date === date && blackoutCovers(b.affectedSlots, slot));
  // Any of them being closed right now says so, whatever an earlier one
  // did ("leave them booked", or MCP's): in minutes it cancels them or
  // offers a new date. As the admin booking page, MCP's get_booking, the
  // 8 PM email and the crew calendar read it, over every closed day that
  // covers it, not whichever Firestore lists first.
  const closing = covering.find((b) => {
    const state = closed.actions.get(b.id)?.state;
    return state === 'pending' || state === 'finalizing';
  });
  if (closing) return { kind: 'closing', reason: closing.reason ?? closed.actions.get(closing.id)?.reason ?? null };
  // A blackout with a closure behind it says more than a bare one (from
  // MCP, say) covering the same departure: prefer it.
  const bo = covering.find((b) => closed.actions.has(b.id)) ?? covering[0];
  const action = bo ? closed.actions.get(bo.id) : undefined;
  const reason = bo?.reason ?? action?.reason ?? null;
  // Everyone on it is choosing a new date, so it isn't going out. Still true
  // once the day is reopened: that puts back on the trip everyone it can
  // (restoreOfferedBookings in functions/src/lib/close-day.ts), and leaves
  // choosing only those whose trip had already left.
  if (counts.live === 0 && counts.moving > 0) return { kind: 'cancelled', reason };
  if (bo && counts.live > 0) return { kind: 'closed-booked', reason };
  return null;
}

/**
 * Departures a finished closure called off whose bookings are all gone
 * (cancelled, or moved and refunded since), so they still show as
 * cancelled rather than vanishing. Guests as they were when it went out;
 * `unknownParty` counts old-site bookings with no party size on file.
 *
 * That includes one Travis closed and left booked ("keep", or from MCP)
 * once he has cancelled or moved everyone it left on it, as the crew
 * calendar shows it. The callers leave out departures that still have
 * bookings going out. `bookings` are any others they read: a departure
 * with one he marked completed or a no-show went out after all, so it
 * isn't called off.
 */
export function calledOffDepartures(
  closed: ClosedDays,
  from: string,
  bookings: ReadonlyArray<{ date: string; timeSlot: string; status: string }>,
): Array<{ date: string; timeSlot: TourTimeSlot; guests: number; bookings: number; unknownParty: number; reason: string | null }> {
  const out = new Map<string, { date: string; timeSlot: TourTimeSlot; guests: number; bookings: number; unknownParty: number; reason: string | null }>();
  const ran = new Set(
    bookings.filter((b) => b.status === 'completed' || b.status === 'no-show').map((b) => `${b.date}|${b.timeSlot}`),
  );
  // A booking left booked by one closing can be named again by another
  // (closed again from MCP, or called off by a later closing): once on
  // each departure.
  const counted = new Set<string>();
  const add = (date: string, reason: string | null, c: { id: string; timeSlot: TourTimeSlot; guests: number }) => {
    const key = `${date}|${c.timeSlot}`;
    if (ran.has(key) || counted.has(`${key}|${c.id}`)) return;
    counted.add(`${key}|${c.id}`);
    const d = out.get(key) ?? { date, timeSlot: c.timeSlot, guests: 0, bookings: 0, unknownParty: 0, reason };
    d.guests += c.guests;
    d.bookings += 1;
    // The closure saves 0 guests when the old site didn't record the party size.
    if (c.guests < 1) d.unknownParty += 1;
    out.set(key, d);
  };
  for (const a of closed.actions.values()) {
    if (a.state !== 'done' || a.date < from || !a.result) continue;
    // Only while the day is still closed: a reopened day is open again.
    if (!closed.blackouts.some((b) => b.id === a.id)) continue;
    const named =
      a.choice === 'keep' ? (a.result.kept ?? []) : [...a.result.cancelled.filter((x) => !x.unpaidCheckout), ...a.result.offered];
    for (const c of named) add(a.date, a.reason, c);
  }
  // Closed from MCP: no closure action, so its alert says whom it left booked.
  for (const b of closed.blackouts) {
    if (b.date < from || closed.actions.has(b.id)) continue;
    for (const c of b.crewAlert?.kept ?? []) add(b.date, b.reason ?? null, c);
  }
  return [...out.values()];
}

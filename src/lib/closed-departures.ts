import 'server-only';
import { adminDb } from './firebase/admin';
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

/** Blackouts and closure actions from `from` to `to` (or on), marina dates. */
export async function fetchClosedDays(from: string, to?: string): Promise<ClosedDays> {
  const db = adminDb();
  let blackoutQ = db.collection('blackouts').where('date', '>=', from);
  let actionQ = db.collection('closureActions').where('date', '>=', from);
  if (to) {
    blackoutQ = blackoutQ.where('date', '<=', to);
    actionQ = actionQ.where('date', '<=', to);
  }
  const [blackouts, actions] = await Promise.all([blackoutQ.get(), actionQ.get()]);
  return {
    blackouts: blackouts.docs.map((d) => ({ ...(d.data() as Omit<BlackoutRow, 'id'>), id: d.id })),
    actions: new Map(actions.docs.map((d) => [d.id, { ...(d.data() as Omit<ClosureRow, 'id'>), id: d.id }])),
  };
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
  const bo = closed.blackouts.find((b) => b.date === date && blackoutCovers(b.affectedSlots, slot));
  const action = bo ? closed.actions.get(bo.id) : undefined;
  const reason = bo?.reason ?? action?.reason ?? null;
  if (action && (action.state === 'pending' || action.state === 'finalizing')) return { kind: 'closing', reason };
  if (counts.live === 0 && counts.moving > 0) return { kind: 'cancelled', reason };
  if (bo && counts.live > 0) return { kind: 'closed-booked', reason };
  return null;
}

/**
 * Departures a finished closure called off whose bookings are all gone
 * (cancelled, or moved and refunded since), so they still show as
 * cancelled rather than vanishing. Guests as they were when it went out.
 */
export function calledOffDepartures(
  closed: ClosedDays,
  from: string,
): Array<{ date: string; timeSlot: TourTimeSlot; guests: number; bookings: number; reason: string | null }> {
  const out = new Map<string, { date: string; timeSlot: TourTimeSlot; guests: number; bookings: number; reason: string | null }>();
  for (const a of closed.actions.values()) {
    if (a.state !== 'done' || a.choice === 'keep' || a.date < from || !a.result) continue;
    // Only while the day is still closed: a reopened day is open again.
    if (!closed.blackouts.some((b) => b.id === a.id)) continue;
    for (const c of [...a.result.cancelled.filter((x) => !x.unpaidCheckout), ...a.result.offered]) {
      const key = `${a.date}|${c.timeSlot}`;
      const d = out.get(key) ?? { date: a.date, timeSlot: c.timeSlot, guests: 0, bookings: 0, reason: a.reason };
      d.guests += c.guests;
      d.bookings += 1;
      out.set(key, d);
    }
  }
  return [...out.values()];
}

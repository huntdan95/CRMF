import 'server-only';
import { adminDb } from './firebase/admin';
import { requireAdmin } from './firebase/auth-server';
import { marinaNow } from './availability';
import { tours } from './tours';
import type { Booking } from './firebase/types';

export interface BookingTotals {
  count: number;
  guests: number;
  /** What customers paid for these tours, less refunds. */
  keptCents: number;
}

export interface DepartureBooking {
  id: string;
  customerName: string;
  customerPhone: string;
  guestCount: number;
  /** Paid on the old website and not fully paid there (a deposit). */
  oldSiteDeposit: boolean;
  /** Travis closed this departure; the customer is picking a new date or a refund. */
  awaitingChoice: boolean;
}

export interface Departure {
  date: string;
  timeSlot: string;
  tourName: string;
  /** "8:00 AM" */
  startTime: string;
  /** Minutes after midnight, marina time. */
  startMinutes: number;
  type: Booking['type'];
  guests: number;
  bookings: DepartureBooking[];
  /**
   * Not going out: Travis closed it (a blackout covers it) or everyone on
   * it is waiting to pick a new date. `sending`: closed in the last few
   * minutes and still in the undo window.
   */
  closed: null | { why: string; sending: boolean };
}

export interface DashboardStats {
  /** False when the numbers couldn't be loaded — show that, not zeros. */
  ok: boolean;
  today: BookingTotals;
  thisWeek: BookingTotals;
  thisMonth: BookingTotals;
  /** The next departure that hasn't left yet. */
  next: Departure | null;
  /** Today's and tomorrow's departures, in time order. */
  todayAndTomorrow: { today: Departure[]; tomorrow: Departure[]; todayIso: string; tomorrowIso: string };
  /** Bookings on closed departures still waiting on the customer's choice, soonest deadline first. */
  awaitingChoice: AwaitingChoice[];
}

export interface AwaitingChoice {
  id: string;
  customerName: string;
  customerPhone: string;
  date: string;
  startTime: string;
  guestCount: number;
  decideBy: string;
  /** Paid on the old website: if they don't choose, Travis refunds by hand. */
  oldSite: boolean;
  remindedAt: string | null;
}

/** Same as closesSlot in functions/src/lib/close-day.ts. */
const WHOLE_DAY_OVERLAPS = ['morning', 'mid-morning', 'early-afternoon'];
function blackoutCovers(affected: string[], slot: string): boolean {
  if (affected.includes('all') || affected.includes(slot)) return true;
  return slot === 'whole-day' && affected.some((s) => WHOLE_DAY_OVERLAPS.includes(s));
}

const CLOSED_WHY: Record<string, string> = {
  weather: 'Closed for weather',
  maintenance: 'Closed for boat maintenance',
};

interface BlackoutLite {
  id: string;
  date: string;
  affectedSlots: string[];
  reason?: string | null;
}

function emptyTotals(): BookingTotals {
  return { count: 0, guests: 0, keptCents: 0 };
}

/** Calendar arithmetic on `YYYY-MM-DD` strings, free of the server's timezone. */
function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function startMinutes(b: Pick<Booking, 'tourId' | 'timeSlot'>): number {
  const tour = tours.find((t) => t.slug === b.tourId) ?? tours.find((t) => t.timeSlot === b.timeSlot);
  const [h, m] = (tour?.startTime ?? '00:00').split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function startDisplay(b: Pick<Booking, 'tourId' | 'timeSlot'>): string {
  const tour = tours.find((t) => t.slug === b.tourId) ?? tours.find((t) => t.timeSlot === b.timeSlot);
  return tour?.startTimeDisplay ?? b.timeSlot;
}

const isLegacy = (b: Booking & { legacy?: unknown }) => !!b.legacy || b.id.startsWith('legacy-');

/**
 * A booking that is really going out on the water: confirmed, or an old-site
 * booking with a deposit. A new-site `pending-payment` is someone sitting in
 * (or who abandoned) Stripe checkout, not a guest.
 */
function goingOut(b: Booking): boolean {
  return b.status === 'confirmed' || (b.status === 'pending-payment' && isLegacy(b));
}

/** Groups bookings into departures (same date and time), in time order. */
function departures(bookings: Booking[], blackouts: BlackoutLite[] = [], sendingIds: Set<string> = new Set()): Departure[] {
  const byKey = new Map<string, Departure>();
  for (const b of [...bookings].sort((x, y) => x.date.localeCompare(y.date) || startMinutes(x) - startMinutes(y))) {
    const key = `${b.date}|${b.timeSlot}`;
    let dep = byKey.get(key);
    if (!dep) {
      dep = {
        date: b.date,
        timeSlot: b.timeSlot,
        tourName: b.tourName,
        startTime: startDisplay(b),
        startMinutes: startMinutes(b),
        type: b.type,
        guests: 0,
        bookings: [],
        closed: null,
      };
      byKey.set(key, dep);
    }
    dep.guests += b.guestCount;
    dep.bookings.push({
      id: b.id,
      customerName: b.customerName,
      customerPhone: b.customerPhone,
      guestCount: b.guestCount,
      oldSiteDeposit: b.status === 'pending-payment',
      awaitingChoice: !!b.closure,
    });
  }
  for (const dep of byKey.values()) {
    const bo = blackouts.find((x) => x.date === dep.date && blackoutCovers(x.affectedSlots, dep.timeSlot));
    if (bo) {
      dep.closed = { why: CLOSED_WHY[bo.reason ?? ''] ?? 'Closed', sending: sendingIds.has(bo.id) };
    } else if (dep.bookings.every((b) => b.awaitingChoice)) {
      dep.closed = { why: 'Closed: guests picking a new date', sending: false };
    }
  }
  return [...byKey.values()];
}

/**
 * Dashboard numbers, computed on marina (Eastern) time. App Hosting's clock
 * is UTC, so "today" from a plain Date would be tomorrow every evening
 * after 8pm. Server-rendered so they're right at first paint.
 *
 * Checks the admin session itself rather than trusting the (protected)
 * layout: Next can render a page without re-running its layout (a client
 * navigation, or a hand-made RSC request claiming the layout is loaded),
 * and these numbers include customers' names and phone numbers.
 */
export async function fetchDashboardStats(): Promise<DashboardStats> {
  await requireAdmin('/admin');
  const now = marinaNow();
  const today = now.date;
  const tomorrow = addDays(today, 1);
  const weekStart = addDays(today, -new Date(`${today}T12:00:00Z`).getUTCDay()); // Sunday
  const weekEnd = addDays(weekStart, 6);
  const monthStart = `${today.slice(0, 7)}-01`;
  const monthEnd = addDays(`${addDays(monthStart, 32).slice(0, 7)}-01`, -1);
  const rangeStart = weekStart < monthStart ? weekStart : monthStart;
  const rangeEnd = weekEnd > monthEnd ? weekEnd : monthEnd;

  try {
    const snap = await adminDb()
      .collection('bookings')
      .where('date', '>=', rangeStart)
      .where('date', '<=', rangeEnd > tomorrow ? rangeEnd : tomorrow)
      .get();
    const all = snap.docs.map((d) => ({ ...(d.data() as Booking), id: d.id }));
    const counted = all.filter((b) => b.status === 'confirmed' || b.status === 'completed');

    function totals(start: string, end: string): BookingTotals {
      const inRange = counted.filter((b) => b.date >= start && b.date <= end);
      return {
        count: inRange.length,
        guests: inRange.reduce((s, b) => s + b.guestCount, 0),
        keptCents: inRange.reduce((s, b) => s + b.amountPaidCents - (b.amountRefundedCents ?? 0), 0),
      };
    }

    const [blackoutSnap, pendingSnap, awaitingSnap] = await Promise.all([
      adminDb().collection('blackouts').where('date', '>=', today).where('date', '<=', tomorrow).get(),
      adminDb().collection('closureActions').where('state', 'in', ['pending', 'finalizing']).get(),
      adminDb().collection('bookings').where('closure.decideBy', '>=', addDays(today, -7)).get(),
    ]);
    const blackouts = blackoutSnap.docs.map((d) => ({ ...(d.data() as Omit<BlackoutLite, 'id'>), id: d.id }));
    const sendingIds = new Set(pendingSnap.docs.map((d) => d.id));
    const soon = departures(
      all.filter((b) => goingOut(b) && (b.date === today || b.date === tomorrow)),
      blackouts,
      sendingIds,
    );

    // The next departure still to leave: later today, or the first after.
    let next = soon.find((d) => !d.closed && (d.date > today || d.startMinutes > now.minutes)) ?? null;
    if (!next) {
      // Page forward to the first date with a live booking: the next few
      // dozen can all be cancelled or abandoned checkouts.
      const PAGE = 100;
      let first: string | null = null;
      let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
      for (let page = 0; page < 10 && !first; page++) {
        let q = adminDb()
          .collection('bookings')
          .where('date', '>', tomorrow)
          .orderBy('date', 'asc')
          .limit(PAGE);
        if (cursor) q = q.startAfter(cursor);
        const later = await q.get();
        const hit = later.docs
          .map((d) => ({ ...(d.data() as Booking), id: d.id }))
          .find((b) => goingOut(b) && !b.closure);
        if (hit) first = hit.date;
        if (later.size < PAGE) break;
        cursor = later.docs[later.docs.length - 1];
      }
      if (first) {
        // That whole day, not just the part that fell on this page.
        const day = await adminDb().collection('bookings').where('date', '==', first).get();
        next = departures(day.docs.map((d) => ({ ...(d.data() as Booking), id: d.id })).filter((b) => goingOut(b) && !b.closure))[0] ?? null;
      }
    }

    return {
      ok: true,
      today: totals(today, today),
      thisWeek: totals(weekStart, weekEnd),
      thisMonth: totals(monthStart, monthEnd),
      next,
      todayAndTomorrow: {
        today: soon.filter((d) => d.date === today),
        tomorrow: soon.filter((d) => d.date === tomorrow),
        todayIso: today,
        tomorrowIso: tomorrow,
      },
      awaitingChoice: awaitingSnap.docs
        .map((d) => ({ ...(d.data() as Booking), id: d.id }))
        .filter((b) => !!b.closure && (b.status === 'confirmed' || b.status === 'pending-payment'))
        .sort((a, b) => a.closure!.decideBy.localeCompare(b.closure!.decideBy) || a.date.localeCompare(b.date))
        .map((b) => ({
          id: b.id,
          customerName: b.customerName,
          customerPhone: b.customerPhone,
          date: b.date,
          startTime: startDisplay(b),
          guestCount: b.guestCount,
          decideBy: b.closure!.decideBy,
          oldSite: isLegacy(b) && b.amountPaidCents - (b.amountRefundedCents ?? 0) > 0,
          remindedAt: b.closure!.reminderSentAt ? b.closure!.reminderSentAt.toDate().toISOString() : null,
        })),
    };
  } catch (err) {
    console.error('Dashboard stats failed', err);
    return {
      ok: false,
      today: emptyTotals(),
      thisWeek: emptyTotals(),
      thisMonth: emptyTotals(),
      next: null,
      todayAndTomorrow: { today: [], tomorrow: [], todayIso: today, tomorrowIso: tomorrow },
      awaitingChoice: [],
    };
  }
}

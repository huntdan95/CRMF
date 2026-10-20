import 'server-only';
import { adminDb } from './firebase/admin';
import { requireAdmin } from './firebase/auth-server';
import { marinaNow } from './availability';
import { formatClock, tours } from './tours';
import { SLOT_MINUTES, slotStartMinutes } from './schedule';
import type { Booking, TourTimeSlot } from './firebase/types';
import {
  blackoutCovers,
  calledOffDepartures,
  departureOff,
  fetchClosedDays,
  type ClosedDays,
  type DepartureOff,
} from './closed-departures';

export interface BookingTotals {
  /** Bookings going out (or that went out): the ones Today and Tomorrow list. */
  count: number;
  /** Bookings on trips Travis called off whose customers are still choosing a new date: not in `count` or `guests`. */
  choosing: number;
  guests: number;
  /** Old-site bookings with no party size on file, not in `guests`: "14+ guests", as the crew see it. */
  unknownParty: number;
  /** What customers paid for tours on these dates, less refunds (by hand too): the Reports page's Kept. */
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
  /** Bookings on it with no party size on file (old-site), not in `guests`. */
  unknownParty: number;
  bookings: DepartureBooking[];
  /** Travis is running it without crew (`soloTrips`). Only looked up for today and tomorrow. */
  noCrew: boolean;
  /** Travis closed it (src/lib/closed-departures.ts). */
  closed: null | DepartureOff;
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
  /**
   * Bookings Travis left on a departure he closed whose date has passed
   * (the trip didn't go out), oldest first, until he moves or cancels them.
   */
  closedStillBooked: ClosedStillBooked[];
}

export interface ClosedStillBooked {
  id: string;
  customerName: string;
  customerPhone: string;
  date: string;
  startTime: string;
  guestCount: number;
}

/**
 * How far back the dashboard looks for closed departures people were left
 * booked on. A trip that didn't go out is sorted out long before this.
 */
const CLOSED_STILL_BOOKED_DAYS = 90;

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

function emptyTotals(): BookingTotals {
  return { count: 0, choosing: 0, guests: 0, unknownParty: 0, keptCents: 0 };
}

/** Calendar arithmetic on `YYYY-MM-DD` strings, free of the server's timezone. */
function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** From the schedule: the sunset cruise leaves at a different time each day. */
function startMinutes(b: Pick<Booking, 'timeSlot' | 'date'>): number {
  return b.timeSlot in SLOT_MINUTES ? slotStartMinutes(b.timeSlot, b.date) : 0;
}

function startDisplay(b: Pick<Booking, 'timeSlot' | 'date'>): string {
  return b.timeSlot in SLOT_MINUTES ? formatClock(startMinutes(b)) : b.timeSlot;
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

/**
 * Same rule as countsTowardMoney on the Reports page
 * (src/components/admin/ReportsAdmin.tsx), so both give the same money for
 * the same dates: everything but an abandoned checkout, or an old-site
 * booking rescheduled there (its payment moved to the booking it became).
 */
function countsTowardMoney(b: Booking): boolean {
  if (b.paymentStatus === 'failed') return false;
  if (isLegacy(b) && b.status === 'cancelled' && b.cancellationReason?.startsWith('Rescheduled on the old site')) return false;
  return true;
}

/** Groups bookings into departures (same date and time), in time order. */
function departures(bookings: Booking[], closedDays?: ClosedDays): Departure[] {
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
        unknownParty: 0,
        bookings: [],
        noCrew: false,
        closed: null,
      };
      byKey.set(key, dep);
    }
    if (b.guestCount > 0) dep.guests += b.guestCount;
    else dep.unknownParty += 1;
    dep.bookings.push({
      id: b.id,
      customerName: b.customerName,
      customerPhone: b.customerPhone,
      guestCount: b.guestCount,
      // Only old-site bookings get here as pending-payment (goingOut), and an
      // old reservation can have nothing paid yet.
      oldSiteDeposit: b.status === 'pending-payment' && b.amountPaidCents > 0,
      awaitingChoice: !!b.closure,
    });
  }
  if (closedDays) {
    for (const dep of byKey.values()) {
      const moving = dep.bookings.filter((b) => b.awaitingChoice).length;
      dep.closed = departureOff(dep.date, dep.timeSlot as TourTimeSlot, { live: dep.bookings.length - moving, moving }, closedDays);
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

    function totals(start: string, end: string): BookingTotals {
      const inRange = all.filter((b) => b.date >= start && b.date <= end);
      // Asked to pick a new date after Travis closed their trip: not going
      // out on it (the crew app leaves them out too), but their money is
      // still held until they move or are refunded.
      const going = inRange.filter((b) => (goingOut(b) && !b.closure) || b.status === 'completed');
      return {
        count: going.length,
        choosing: inRange.filter((b) => goingOut(b) && !!b.closure).length,
        guests: going.reduce((s, b) => s + Math.max(0, b.guestCount), 0),
        unknownParty: going.filter((b) => !(b.guestCount > 0)).length,
        // Whatever happened to the booking: a no-show or a late cancellation
        // still leaves money with the business. Old-site money Travis owes
        // back by hand on a cancelled booking isn't kept either.
        keptCents: inRange
          .filter(countsTowardMoney)
          .reduce((s, b) => s + b.amountPaidCents - (b.amountRefundedCents ?? 0) - (b.manualRefundCents ?? 0), 0),
      };
    }

    const [closedDays, awaitingSnap, closedStillBooked] = await Promise.all([
      fetchClosedDays(today, tomorrow),
      adminDb().collection('bookings').where('closure.decideBy', '>=', addDays(today, -7)).get(),
      fetchClosedStillBooked(today),
    ]);
    const soon = departures(
      all.filter((b) => goingOut(b) && (b.date === today || b.date === tomorrow)),
      closedDays,
    );
    // Called off with everyone cancelled: still listed, marked, so the day
    // doesn't just look empty.
    for (const d of calledOffDepartures(closedDays, today)) {
      if (soon.some((x) => x.date === d.date && x.timeSlot === d.timeSlot)) continue;
      const tour = tours.find((t) => t.timeSlot === d.timeSlot);
      soon.push({
        date: d.date,
        timeSlot: d.timeSlot,
        tourName: tour?.name ?? d.timeSlot,
        startTime: startDisplay({ timeSlot: d.timeSlot, date: d.date }),
        startMinutes: startMinutes({ timeSlot: d.timeSlot, date: d.date }),
        type: tour?.type ?? 'shared',
        guests: d.guests,
        unknownParty: d.unknownParty,
        bookings: [],
        noCrew: false,
        closed: { kind: 'cancelled', reason: d.reason },
      });
    }
    soon.sort((x, y) => x.date.localeCompare(y.date) || x.startMinutes - y.startMinutes);
    if (soon.length > 0) {
      const solo = await adminDb().getAll(
        ...soon.map((d) => adminDb().collection('soloTrips').doc(`${d.date}_${d.timeSlot}`)),
      );
      soon.forEach((d, i) => (d.noCrew = !!solo[i]?.exists));
    }

    // The next departure still to leave: later today, or the first after.
    // Not one Travis closed (`closed`), even left booked: the crew app shows
    // that as Closed, and it isn't going out unless he says it went after
    // all, which he can only do once it has left.
    let next = soon.find((d) => !d.closed && d.bookings.length > 0 && (d.date > today || d.startMinutes > now.minutes)) ?? null;
    if (!next) {
      // Page forward to the first date with a live booking on a departure
      // that's going out: the next few dozen can all be cancelled or
      // abandoned checkouts, or on trips he closed.
      const PAGE = 100;
      let closedLater: ClosedDays | undefined;
      const tried = new Set<string>();
      let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
      for (let page = 0; page < 10 && !next; page++) {
        let q = adminDb()
          .collection('bookings')
          .where('date', '>', tomorrow)
          .orderBy('date', 'asc')
          .limit(PAGE);
        if (cursor) q = q.startAfter(cursor);
        const later = await q.get();
        const dates = later.docs
          .map((d) => ({ ...(d.data() as Booking), id: d.id }))
          .filter((b) => goingOut(b) && !b.closure && !tried.has(b.date))
          .map((b) => b.date);
        for (const date of new Set(dates)) {
          tried.add(date);
          closedLater ??= await fetchClosedDays(addDays(tomorrow, 1));
          // That whole day, not just the part that fell on this page.
          const day = await adminDb().collection('bookings').where('date', '==', date).get();
          const live = day.docs.map((d) => ({ ...(d.data() as Booking), id: d.id })).filter((b) => goingOut(b) && !b.closure);
          next = departures(live, closedLater).find((d) => !d.closed) ?? null;
          if (next) break;
        }
        if (later.size < PAGE) break;
        cursor = later.docs[later.docs.length - 1];
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
      closedStillBooked,
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
      closedStillBooked: [],
    };
  }
}

/**
 * Today and Tomorrow show a departure Travis closed and left people booked
 * on as "Closed, still booked". Once its date has passed it's in neither,
 * but those bookings still read as confirmed (and their money as kept)
 * until he moves or cancels them, so they're listed on their own. Only
 * dates a blackout still covers, from the last {@link CLOSED_STILL_BOOKED_DAYS}
 * days: a day he reopened ran as normal.
 */
async function fetchClosedStillBooked(today: string): Promise<ClosedStillBooked[]> {
  const past = await fetchClosedDays(addDays(today, -CLOSED_STILL_BOOKED_DAYS), addDays(today, -1));
  const dates = [...new Set(past.blackouts.map((b) => b.date))];
  const found: Booking[] = [];
  // `in` takes up to 30 values.
  for (let i = 0; i < dates.length; i += 30) {
    const snap = await adminDb().collection('bookings').where('date', 'in', dates.slice(i, i + 30)).get();
    found.push(...snap.docs.map((d) => ({ ...(d.data() as Booking), id: d.id })));
  }
  return found
    .filter(
      (b) =>
        goingOut(b) &&
        !b.closure &&
        past.blackouts.some((bo) => bo.date === b.date && blackoutCovers(bo.affectedSlots, b.timeSlot)),
    )
    .sort((x, y) => x.date.localeCompare(y.date) || startMinutes(x) - startMinutes(y))
    .map((b) => ({
      id: b.id,
      customerName: b.customerName,
      customerPhone: b.customerPhone,
      date: b.date,
      startTime: startDisplay(b),
      guestCount: b.guestCount,
    }));
}

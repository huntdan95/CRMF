import 'server-only';
import { adminDb } from './firebase/admin';
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
function departures(bookings: Booking[]): Departure[] {
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
    });
  }
  return [...byKey.values()];
}

/**
 * Dashboard numbers, computed on marina (Eastern) time. App Hosting's clock
 * is UTC, so "today" from a plain Date would be tomorrow every evening
 * after 8pm. Server-rendered so they're right at first paint.
 */
export async function fetchDashboardStats(): Promise<DashboardStats> {
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

    const soon = departures(all.filter((b) => goingOut(b) && (b.date === today || b.date === tomorrow)));

    // The next departure still to leave: later today, or the first after.
    let next = soon.find((d) => d.date > today || d.startMinutes > now.minutes) ?? null;
    if (!next) {
      const later = await adminDb()
        .collection('bookings')
        .where('date', '>', tomorrow)
        .orderBy('date', 'asc')
        .limit(40)
        .get();
      const upcoming = later.docs.map((d) => ({ ...(d.data() as Booking), id: d.id })).filter(goingOut);
      if (upcoming.length) {
        const first = upcoming[0]!.date;
        next = departures(upcoming.filter((b) => b.date === first))[0] ?? null;
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
    };
  }
}

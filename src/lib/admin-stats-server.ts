import 'server-only';
import { adminDb } from './firebase/admin';
import { isoDate } from './date';
import type { Booking } from './firebase/types';

export interface BookingTotals {
  count: number;
  guests: number;
  grossCents: number;
}

export interface DashboardStats {
  today: BookingTotals;
  thisWeek: BookingTotals;
  thisMonth: BookingTotals;
  nextTour: {
    bookingId: string;
    date: string;
    timeSlot: string;
    tourName: string;
    customerName: string;
    guestCount: number;
  } | null;
}

function emptyTotals(): BookingTotals {
  return { count: 0, guests: 0, grossCents: 0 };
}

function startOfWeek(d: Date): Date {
  const r = new Date(d);
  const day = r.getDay(); // 0 = Sunday
  r.setDate(r.getDate() - day);
  r.setHours(0, 0, 0, 0);
  return r;
}

function endOfWeek(d: Date): Date {
  const r = startOfWeek(d);
  r.setDate(r.getDate() + 6);
  return r;
}

function startOfMonth(d: Date): Date {
  const r = new Date(d.getFullYear(), d.getMonth(), 1);
  r.setHours(0, 0, 0, 0);
  return r;
}

function endOfMonth(d: Date): Date {
  const r = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  r.setHours(23, 59, 59, 999);
  return r;
}

/**
 * Computes today/this-week/this-month/next-tour stats from the bookings
 * collection. Server-rendered so the values are correct at first paint —
 * no loading state on the dashboard.
 */
export async function fetchDashboardStats(): Promise<DashboardStats> {
  const today = new Date();
  const todayIso = isoDate(today);
  const weekStartIso = isoDate(startOfWeek(today));
  const weekEndIso = isoDate(endOfWeek(today));
  const monthStartIso = isoDate(startOfMonth(today));
  const monthEndIso = isoDate(endOfMonth(today));

  try {
    // Pull a generous window once, slice in JS.
    const snap = await adminDb()
      .collection('bookings')
      .where('date', '>=', monthStartIso)
      .where('date', '<=', monthEndIso)
      .get();

    const all = snap.docs.map((d) => d.data() as Booking);
    // Only count confirmed/completed bookings toward revenue + counts.
    const counted = all.filter(
      (b) => b.status === 'confirmed' || b.status === 'completed',
    );

    function totalsForRange(start: string, end: string): BookingTotals {
      const bookings = counted.filter((b) => b.date >= start && b.date <= end);
      return {
        count: bookings.length,
        guests: bookings.reduce((s, b) => s + b.guestCount, 0),
        grossCents: bookings.reduce((s, b) => s + b.amountPaidCents, 0),
      };
    }

    // Next upcoming tour — pulled separately because it can be outside the
    // current month.
    let nextTour: DashboardStats['nextTour'] = null;
    try {
      const next = await adminDb()
        .collection('bookings')
        .where('date', '>=', todayIso)
        .orderBy('date', 'asc')
        .limit(20)
        .get();
      const upcoming = next.docs
        .map((d) => d.data() as Booking)
        .find(
          (b) => b.status === 'confirmed' || b.status === 'pending-payment',
        );
      if (upcoming) {
        nextTour = {
          bookingId: upcoming.id,
          date: upcoming.date,
          timeSlot: upcoming.timeSlot,
          tourName: upcoming.tourName,
          customerName: upcoming.customerName,
          guestCount: upcoming.guestCount,
        };
      }
    } catch {
      // Index might not exist yet for the orderBy; non-fatal.
      nextTour = null;
    }

    return {
      today: totalsForRange(todayIso, todayIso),
      thisWeek: totalsForRange(weekStartIso, weekEndIso),
      thisMonth: totalsForRange(monthStartIso, monthEndIso),
      nextTour,
    };
  } catch {
    return {
      today: emptyTotals(),
      thisWeek: emptyTotals(),
      thisMonth: emptyTotals(),
      nextTour: null,
    };
  }
}

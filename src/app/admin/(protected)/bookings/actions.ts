'use server';

import { adminDb } from '@/lib/firebase/admin';
import { getAdminUser } from '@/lib/firebase/auth-server';

/**
 * One booking as the bookings list's search sees it: id, tour date, time
 * slot, customer name, email and phone, tour name, and the old site's
 * booking # (null for one booked here). A tuple, since it's every booking.
 */
export type BookingSearchRow = [
  id: string,
  date: string,
  timeSlot: string,
  customerName: string,
  customerEmail: string,
  customerPhone: string,
  tourName: string,
  oldBookingId: number | null,
];

/**
 * What Admin → Bookings searches: those few fields of every booking there
 * is, so a search finds last season's customers and old-site booking
 * numbers too. Read here because the browser's Firestore can't ask for
 * only some fields, and every booking in full is megabytes on a phone.
 */
export async function bookingSearchRows(): Promise<{ ok: true; rows: BookingSearchRow[] } | { ok: false; error: string }> {
  const user = await getAdminUser();
  if (!user) return { ok: false, error: 'Your admin session has ended. Sign in again.' };
  try {
    const snap = await adminDb()
      .collection('bookings')
      .select('date', 'timeSlot', 'customerName', 'customerEmail', 'customerPhone', 'tourName', 'legacy.bookingId')
      .get();
    const text = (v: unknown) => (typeof v === 'string' ? v : '');
    return {
      ok: true,
      rows: snap.docs.map((d) => {
        const oldId = d.get('legacy.bookingId') as unknown;
        return [
          d.id,
          text(d.get('date')),
          text(d.get('timeSlot')),
          text(d.get('customerName')),
          text(d.get('customerEmail')),
          text(d.get('customerPhone')),
          text(d.get('tourName')),
          typeof oldId === 'number' ? oldId : null,
        ];
      }),
    };
  } catch (err) {
    console.error('Bookings search: read failed', err);
    return { ok: false, error: 'Couldn’t search every booking just now.' };
  }
}

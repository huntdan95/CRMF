import type { Firestore } from 'firebase-admin/firestore';

import { db as defaultDb, FieldValue } from './firebase';
import type { Booking } from './types';

export type AdminManualRefundOutcome =
  | { kind: 'recorded'; manualRefundCents: number }
  /** Recorded before: a second tap, or another admin got there first. */
  | { kind: 'already-recorded' }
  | { kind: 'not-found' }
  /** Not a cancelled booking with old-site money owed back. */
  | { kind: 'nothing-owed' };

/**
 * Admin's "Refunded by hand": Travis has paid back the old-site money a
 * cancellation left owing (`manualRefundCents`), in Stripe or on the old
 * site, and says so. Nothing moves here; it stamps `manualRefundedAt` so
 * the booking page stops saying he will and the admin stops listing it as
 * owed. `manualRefundCents` stays as the amount, so Reports and the
 * dashboard count it as given back either way.
 *
 * Admin site only, not MCP: the MCP token can't do anything about money,
 * and this tells the customer they've been paid.
 */
export async function adminManualRefundOne(
  bookingId: string,
  deps: { db?: Firestore } = {},
): Promise<AdminManualRefundOutcome> {
  const db = deps.db ?? defaultDb;
  const ref = db.collection('bookings').doc(bookingId);

  return db.runTransaction<AdminManualRefundOutcome>(async (tx) => {
    const booking = (await tx.get(ref)).data() as Booking | undefined;
    if (!booking) return { kind: 'not-found' };
    if (booking.manualRefundedAt) return { kind: 'already-recorded' };
    const owed = booking.manualRefundCents ?? 0;
    if (booking.status !== 'cancelled' || owed <= 0) return { kind: 'nothing-owed' };

    tx.update(ref, {
      manualRefundedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { kind: 'recorded', manualRefundCents: owed };
  });
}

import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import type { Firestore } from 'firebase-admin/firestore';
import type Stripe from 'stripe';

import { db as defaultDb } from './lib/firebase';
import { STRIPE_SECRET_KEY, getStripe } from './lib/stripe';
import { RESEND_API_KEY, RESEND_FROM_EMAIL } from './lib/resend';
import { adminCancelOne, type CancellationMailer } from './lib/admin-cancel';
import { awaitingMove } from './lib/closure';
import { marinaNow } from './lib/datetime';
import { customerMailer } from './lib/customer-mailer';
import type { Booking } from './lib/types';

/**
 * Cancels and refunds in full every closed booking whose customer didn't
 * pick a new date or a refund by `closure.decideBy` (lib/closure.ts), as
 * if Travis had cancelled it. Each customer gets the cancellation email,
 * copied to Travis; old-site money gets a note for him to refund by hand.
 * A booking moved, or put back on its trip, while this runs is left alone.
 */
export async function settleExpiredClosures(deps: {
  db?: Firestore;
  stripe: Pick<Stripe, 'checkout' | 'refunds'>;
  mailer: CancellationMailer;
  now?: Date;
}): Promise<{ settled: string[]; failed: string[] }> {
  const db = deps.db ?? defaultDb;
  const today = marinaNow(deps.now).date;
  const snap = await db.collection('bookings').where('closure.decideBy', '<', today).get();
  const expired = snap.docs
    .map((d) => ({ ...(d.data() as Booking), id: d.id }))
    .filter(awaitingMove);

  const result = { settled: [] as string[], failed: [] as string[] };
  for (const booking of expired) {
    try {
      const outcome = await adminCancelOne(
        booking.id,
        {
          reason: booking.closure!.reason,
          notifyCustomer: true,
          cause: 'blackout',
          // Travis may move it, or reopen the day, as this runs: then it's
          // no longer this closure's to refund.
          expect: { date: booking.date, timeSlot: booking.timeSlot, closureBlackoutId: booking.closure!.blackoutId },
          emailCause: 'deadline-passed',
        },
        { db, stripe: deps.stripe, mailer: deps.mailer },
      );
      if (outcome.kind === 'cancelled') result.settled.push(booking.id);
      else if (outcome.kind === 'changed' || outcome.kind === 'already-cancelled') {
        // Nothing left to settle. A refund that went out just before stands,
        // and the booking's notes tell Travis.
        if (outcome.stripeRefundId) logger.error('A closed booking changed just as it was refunded', { bookingId: booking.id, outcome });
      } else result.failed.push(booking.id);
    } catch (err) {
      logger.error('Settling a closed booking failed', { bookingId: booking.id, err });
      result.failed.push(booking.id);
    }
  }
  return result;
}

/** 6:00 AM marina time, once the last day to choose is over. */
export const settleClosedBookings = onSchedule(
  {
    schedule: 'every day 06:00',
    timeZone: 'America/New_York',
    region: 'us-central1',
    secrets: [STRIPE_SECRET_KEY, RESEND_API_KEY, RESEND_FROM_EMAIL],
    retryCount: 0,
    // A Stripe refund and an email per booking, like finalizeClosures.
    timeoutSeconds: 300,
  },
  async () => {
    const result = await settleExpiredClosures({ stripe: getStripe(), mailer: customerMailer() });
    if (result.settled.length || result.failed.length) logger.info('Settled closed bookings', result);
    if (result.failed.length) logger.error('Some closed bookings weren’t settled; the next run retries them', result);
  },
);

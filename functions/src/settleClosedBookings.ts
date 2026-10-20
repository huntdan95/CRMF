import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import type { Firestore } from 'firebase-admin/firestore';
import type Stripe from 'stripe';

import { db as defaultDb, FieldValue } from './lib/firebase';
import { STRIPE_SECRET_KEY, getStripe } from './lib/stripe';
import { RESEND_API_KEY, RESEND_FROM_EMAIL } from './lib/resend';
import { adminCancelOne, type CancellationMailer } from './lib/admin-cancel';
import { awaitingMove } from './lib/closure';
import { marinaNow } from './lib/datetime';
import { customerMailer } from './lib/customer-mailer';
import { buildCancellationEmail } from './lib/email-templates';
import type { Booking } from './lib/types';

/**
 * Cancels and refunds in full every closed booking whose customer didn't
 * pick a new date or a refund by `closure.decideBy` (lib/closure.ts), as
 * if Travis had cancelled it. Each customer gets the cancellation email,
 * copied to Travis (one Resend refuses goes on the next run:
 * {@link resendDeadlineEmails}); old-site money gets a note for him to
 * refund by hand.
 * A booking moved, or put back on its trip, while this runs is left alone.
 *
 * That includes a closure a reopen under the previous version left behind
 * (isStaleClosure in lib/close-day.ts): the customer was promised this
 * refund if they didn't choose. If they went out anyway, Travis marking the
 * trip takes the closure off first (lib/admin-mark.ts).
 */
export async function settleExpiredClosures(deps: {
  db?: Firestore;
  stripe: Pick<Stripe, 'checkout' | 'refunds'>;
  mailer: CancellationMailer;
  now?: Date;
}): Promise<{ settled: string[]; failed: string[] }> {
  const db = deps.db ?? defaultDb;
  const today = marinaNow(deps.now).date;
  // Only the statuses awaitingMove takes: a closure stays on a booking after
  // it's refunded or cancelled, so without them this would read every
  // booking ever offered a new date, every day. Index: status, closure.decideBy.
  const snap = await db
    .collection('bookings')
    .where('status', 'in', ['confirmed', 'pending-payment'])
    .where('closure.decideBy', '<', today)
    .get();
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
      if (outcome.kind === 'cancelled') {
        result.settled.push(booking.id);
        // Refunded, but Resend refused the email (an outage at 6 AM, say),
        // and nothing else would tell them: the next run sends it.
        if (outcome.emailFailed) {
          const unsent: UnsentDeadlineEmail = {
            sent: false,
            refundCents: outcome.refundCents,
            manualRefundCents: outcome.manualRefundCents,
            previouslyRefundedCents: booking.amountRefundedCents ?? 0,
          };
          await db
            .collection('bookings')
            .doc(booking.id)
            .update({ deadlineEmail: unsent })
            .catch((err) => logger.error('A deadline cancellation’s email failed and couldn’t be kept to send again', { bookingId: booking.id, err }));
        }
      } else if (outcome.kind === 'changed' || outcome.kind === 'already-cancelled') {
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

/**
 * A deadline cancellation whose email Resend refused: what the email says,
 * kept on the booking (`deadlineEmail`) until a later run sends it.
 */
interface UnsentDeadlineEmail {
  sent: false;
  refundCents: number;
  manualRefundCents: number;
  previouslyRefundedCents: number;
}

/**
 * Sends each deadline cancellation email an earlier run couldn't, as
 * adminCancelOne would have, under one idempotency key per booking.
 * Returns the bookings emailed; one refused again waits for the next run.
 */
export async function resendDeadlineEmails(deps: { db?: Firestore; mailer: CancellationMailer }): Promise<string[]> {
  const db = deps.db ?? defaultDb;
  const snap = await db.collection('bookings').where('deadlineEmail.sent', '==', false).get();
  const sent: string[] = [];
  for (const doc of snap.docs) {
    const booking = { ...(doc.data() as Booking & { deadlineEmail: UnsentDeadlineEmail }), id: doc.id };
    const unsent = booking.deadlineEmail;
    try {
      const { subject, html, text } = buildCancellationEmail({
        booking,
        refundCents: unsent.refundCents,
        refundPercent: 100,
        cancelledBy: 'admin',
        reason: booking.cancellationReason ?? undefined,
        marina: deps.mailer.marina,
        phoneDisplay: deps.mailer.phoneDisplay,
        manualRefundCents: unsent.manualRefundCents,
        previouslyRefundedCents: unsent.previouslyRefundedCents,
        cause: 'deadline-passed',
      });
      await deps.mailer.send({
        to: booking.customerEmail,
        subject,
        html,
        text,
        bookingId: booking.id,
        idempotencyKey: `deadline-cancel/${booking.id}`,
      });
      await db.collection('bookings').doc(booking.id).update({ deadlineEmail: FieldValue.delete() });
      sent.push(booking.id);
    } catch (err) {
      logger.error('A deadline cancellation’s email failed again; the next run tries again', { bookingId: booking.id, err });
    }
  }
  return sent;
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
    const resent = await resendDeadlineEmails({ mailer: customerMailer() });
    if (resent.length) logger.info('Sent deadline cancellation emails an earlier run couldn’t', { resent });
    const result = await settleExpiredClosures({ stripe: getStripe(), mailer: customerMailer() });
    if (result.settled.length || result.failed.length) logger.info('Settled closed bookings', result);
    if (result.failed.length) logger.error('Some closed bookings weren’t settled; the next run retries them', result);
  },
);

import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import type { Firestore } from 'firebase-admin/firestore';
import type Stripe from 'stripe';

import { db as defaultDb, FieldValue, Timestamp } from './lib/firebase';
import { STRIPE_SECRET_KEY, getStripe } from './lib/stripe';
import { RESEND_API_KEY, RESEND_FROM_EMAIL } from './lib/resend';
import { ADMIN_EMAIL, APP_BASE_URL } from './lib/config';
import {
  adminCancelOne,
  cancellationEmailKey,
  emailRefusedForGood,
  keepUnsentCancellationEmail,
  recordRefusedCancellationEmail,
  type CancellationMailer,
  type UnsentCancellationEmail,
} from './lib/admin-cancel';
import { awaitingMove } from './lib/closure';
import { marinaNow } from './lib/datetime';
import { customerMailer } from './lib/customer-mailer';
import { isEmailSendError, sendEmail } from './lib/email-log';
import { buildCancellationEmail, buildDeadlineRefundRefusedEmail } from './lib/email-templates';
import { formatPrice } from './lib/tours';
import type { Booking } from './lib/types';

/** A deadline refund Stripe turned down, for Travis's alert. */
export interface DeadlineRefundRefused {
  booking: Booking & { id: string };
  refundCents: number;
  stripeMessage: string;
}

/**
 * Stripe turning a refund down (the payment is too old to refund, or
 * disputed), as cancelBooking's refundRefused tells it: trying again every
 * morning won't change it, and only Travis can sort it out. Not Stripe's
 * 409, another request refunding under the same key at that moment.
 */
function refundRefused(err: unknown): err is Error {
  const e = err as { type?: unknown; statusCode?: unknown; code?: unknown } | null;
  if (!(err instanceof Error) || e?.statusCode === 409 || e?.code === 'idempotency_key_in_use') return false;
  return e?.type === 'StripeInvalidRequestError' || e?.type === 'StripeCardError';
}

/**
 * Cancels and refunds in full every closed booking whose customer didn't
 * pick a new date or a refund by `closure.decideBy` (lib/closure.ts), as
 * if Travis had cancelled it. Each customer gets the cancellation email,
 * copied to Travis (one Resend refuses goes on the hourly closure run:
 * {@link resendDeadlineEmails}); old-site money gets a note for him to
 * refund by hand.
 * A booking moved, or put back on its trip, while this runs is left alone.
 *
 * A refund Stripe turns down (`refused`) leaves the booking as it is,
 * stamped `closure.refundRefused`, and emails Travis once: later runs
 * don't try it again, only that email if it didn't go.
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
  /** Emails Travis about a refund Stripe turned down. */
  alertRefundRefused?: (alert: DeadlineRefundRefused) => Promise<void>;
}): Promise<{ settled: string[]; failed: string[]; refused: string[] }> {
  const db = deps.db ?? defaultDb;
  const now = deps.now ?? new Date();
  const today = marinaNow(now).date;
  const alertRefundRefused = deps.alertRefundRefused ?? sendDeadlineRefundRefusedAlert;
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

  const result = { settled: [] as string[], failed: [] as string[], refused: [] as string[] };
  for (const booking of expired) {
    const refused = booking.closure!.refundRefused;
    if (refused) {
      // Turned down on an earlier run: trying again won't change that.
      // Travis's email, if it didn't go then, does now.
      if (!refused.alertedAt) {
        await alertOnce(db, booking, { refundCents: refused.refundCents, stripeMessage: refused.stripeMessage }, alertRefundRefused, now);
      }
      continue;
    }
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
        // and nothing else would tell them: the hourly closure run sends it.
        // Not one refused for good (the address), which adminCancelOne
        // flagged on the booking instead.
        if (outcome.emailFailed && !outcome.emailRejected) {
          await keepUnsentCancellationEmail(db, booking.id, {
            sent: false,
            refundCents: outcome.refundCents,
            manualRefundCents: outcome.manualRefundCents,
            previouslyRefundedCents: booking.amountRefundedCents ?? 0,
          });
        }
      } else if (outcome.kind === 'changed' || outcome.kind === 'already-cancelled') {
        // Nothing left to settle. A refund that went out just before stands,
        // and the booking's notes tell Travis.
        if (outcome.stripeRefundId) logger.error('A closed booking changed just as it was refunded', { bookingId: booking.id, outcome });
      } else result.failed.push(booking.id);
    } catch (err) {
      if (refundRefused(err)) {
        // adminCancelOne refunds before it writes, so nothing changed.
        logger.error('Stripe turned down a closed booking’s deadline refund', { bookingId: booking.id, err });
        const refusal = { refundCents: Math.max(0, booking.amountPaidCents - (booking.amountRefundedCents ?? 0)), stripeMessage: err.message };
        if (await stampRefundRefused(db, booking, refusal, now)) {
          result.refused.push(booking.id);
          await alertOnce(db, booking, refusal, alertRefundRefused, now);
        }
        continue;
      }
      logger.error('Settling a closed booking failed', { bookingId: booking.id, err });
      result.failed.push(booking.id);
    }
  }
  return result;
}

/**
 * Marks the deadline refund Stripe turned down on the booking, with a note,
 * while it's still waiting on the same closure: one moved or put back on
 * its trip meanwhile isn't this closure's to refund any more.
 */
async function stampRefundRefused(
  db: Firestore,
  booking: Booking & { id: string },
  refusal: { refundCents: number; stripeMessage: string },
  now: Date,
): Promise<boolean> {
  const ref = db.collection('bookings').doc(booking.id);
  return db.runTransaction(async (tx) => {
    const fresh = (await tx.get(ref)).data() as Booking | undefined;
    if (!fresh || !awaitingMove(fresh) || fresh.closure!.blackoutId !== booking.closure!.blackoutId || fresh.closure!.refundRefused) {
      return false;
    }
    const note = `${marinaNow(now).date}: The ${formatPrice(refusal.refundCents)} refund due at the deadline to pick a new date was turned down by Stripe (“${refusal.stripeMessage}”). Nothing was cancelled or refunded.`;
    tx.update(ref, {
      closure: { ...fresh.closure, refundRefused: { at: Timestamp.fromDate(now), ...refusal } },
      adminNotes: fresh.adminNotes ? `${fresh.adminNotes}\n${note}` : note,
      updatedAt: FieldValue.serverTimestamp(),
    });
    return true;
  });
}

/**
 * Emails Travis about a deadline refund Stripe turned down, then stamps
 * `closure.refundRefused.alertedAt`, again only while it's still waiting
 * on that closure. One that fails is logged and tried on the next run.
 */
async function alertOnce(
  db: Firestore,
  booking: Booking & { id: string },
  refusal: { refundCents: number; stripeMessage: string },
  alert: (a: DeadlineRefundRefused) => Promise<void>,
  now: Date,
): Promise<void> {
  try {
    await alert({ booking, ...refusal });
  } catch (err) {
    logger.error('The refund-refused email to Travis failed; the next run tries again', { bookingId: booking.id, err });
    return;
  }
  const ref = db.collection('bookings').doc(booking.id);
  await db
    .runTransaction(async (tx) => {
      const fresh = (await tx.get(ref)).data() as Booking | undefined;
      const closure = fresh?.closure;
      if (!closure?.refundRefused || closure.blackoutId !== booking.closure!.blackoutId) return;
      tx.update(ref, { closure: { ...closure, refundRefused: { ...closure.refundRefused, alertedAt: Timestamp.fromDate(now) } } });
    })
    .catch((err) => logger.error('Couldn’t record that Travis was emailed about a refused refund', { bookingId: booking.id, err }));
}

/**
 * The email to Travis, once per booking and closure (Resend's idempotency
 * key; one that differs is turned away as `invalid_idempotent_request`).
 */
async function sendDeadlineRefundRefusedAlert(alert: DeadlineRefundRefused): Promise<void> {
  const { subject, html, text } = buildDeadlineRefundRefusedEmail({ ...alert, baseUrl: APP_BASE_URL.value() });
  try {
    await sendEmail({
      kind: 'admin',
      bookingId: alert.booking.id,
      to: ADMIN_EMAIL.value(),
      subject,
      html,
      text,
      replyTo: alert.booking.customerEmail || undefined,
      headers: { 'X-Entity-Ref-ID': alert.booking.id },
      idempotencyKey: `closure-refund-refused/${alert.booking.id}/${alert.booking.closure?.blackoutId ?? ''}`,
    });
  } catch (err) {
    if (isEmailSendError(err, 'invalid_idempotent_request') || isEmailSendError(err, 'concurrent_idempotent_requests')) return;
    throw err;
  }
}

/**
 * Sends each closure cancellation email an earlier run couldn't (the
 * deadline's, or the closure's own as it went out), and each one Travis's
 * own Cancel couldn't, as adminCancelOne would have, under the key
 * adminCancelOne used: if that first try went after all, this one doesn't
 * go twice. Run hourly with the closure reminders. Returns the bookings
 * emailed; one refused again waits for the next run, unless Resend refused
 * it for good (the address): that's flagged on the booking as a bounce, for
 * Travis to check the address, and not tried again. One no longer
 * cancelled (the old-site re-sync put it back) is dropped, not sent.
 */
export async function resendDeadlineEmails(deps: { db?: Firestore; mailer: CancellationMailer }): Promise<string[]> {
  const db = deps.db ?? defaultDb;
  const snap = await db.collection('bookings').where('deadlineEmail.sent', '==', false).get();
  const sent: string[] = [];
  for (const doc of snap.docs) {
    const booking = { ...(doc.data() as Booking & { deadlineEmail: UnsentCancellationEmail }), id: doc.id };
    if (booking.status !== 'cancelled') {
      // Booked again: telling them it's cancelled would be wrong. Read again
      // as it's cleared, in case it was cancelled again just now.
      const ref = db.collection('bookings').doc(booking.id);
      await db
        .runTransaction(async (tx) => {
          if ((await tx.get(ref)).data()?.status !== 'cancelled') tx.update(ref, { deadlineEmail: FieldValue.delete() });
        })
        .catch((err) => logger.error('Couldn’t drop the unsent cancellation email of a booking that’s no longer cancelled', { bookingId: booking.id, err }));
      continue;
    }
    const unsent = booking.deadlineEmail;
    let subject = '';
    try {
      const email = buildCancellationEmail({
        booking,
        refundCents: unsent.refundCents,
        refundPercent: 100,
        cancelledBy: 'admin',
        reason: booking.cancellationReason ?? undefined,
        marina: deps.mailer.marina,
        phoneDisplay: deps.mailer.phoneDisplay,
        manualRefundCents: unsent.manualRefundCents,
        previouslyRefundedCents: unsent.previouslyRefundedCents,
        // Travis's own Cancel: the plain cancellation email, no closure in it.
        cause: unsent.cause === 'admin' ? undefined : (unsent.cause ?? 'deadline-passed'),
      });
      subject = email.subject;
      await deps.mailer.send({
        to: booking.customerEmail,
        subject,
        html: email.html,
        text: email.text,
        bookingId: booking.id,
        idempotencyKey: cancellationEmailKey(booking.id),
      });
      await db.collection('bookings').doc(booking.id).update({ deadlineEmail: FieldValue.delete() });
      sent.push(booking.id);
    } catch (err) {
      if (emailRefusedForGood(err)) {
        logger.error('Resend refused a closure cancellation’s email for good; flagged on the booking', { bookingId: booking.id, err });
        await recordRefusedCancellationEmail(db, booking.id, { to: booking.customerEmail, subject, err }, { deadlineEmail: FieldValue.delete() });
        continue;
      }
      logger.error('A closure cancellation’s email failed again; the next run tries again', { bookingId: booking.id, err });
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
    secrets: [STRIPE_SECRET_KEY, RESEND_API_KEY, RESEND_FROM_EMAIL, APP_BASE_URL],
    retryCount: 0,
    // A Stripe refund and an email per booking, like finalizeClosures.
    timeoutSeconds: 300,
  },
  async () => {
    const result = await settleExpiredClosures({ stripe: getStripe(), mailer: customerMailer() });
    if (result.settled.length || result.failed.length || result.refused.length) logger.info('Settled closed bookings', result);
    if (result.failed.length) logger.error('Some closed bookings weren’t settled; the next run retries them', result);
  },
);

import { logger } from 'firebase-functions/v2';
import type { Firestore } from 'firebase-admin/firestore';
import type Stripe from 'stripe';

import { db as defaultDb, FieldValue } from './firebase';
import { buildCancellationEmail, type CancellationCause } from './email-templates';
import type { EmailKind } from './email-log';
import { marinaNow } from './datetime';
import { refundedTotalAfter } from './stripe';
import { formatPrice } from './tours';
import { isLegacyBooking, type Booking } from './types';

/**
 * A Stripe refund this call got through before finding the booking had been
 * cancelled or moved another way meanwhile. The money has gone back all the
 * same, so it's recorded on the booking; set only then.
 */
interface LateRefund {
  refundCents?: number;
  stripeRefundId?: string;
}

export type AdminCancelOutcome =
  | {
      kind: 'cancelled';
      /** Refunded through Stripe just now. */
      refundCents: number;
      /** Paid on the old website: Travis has to refund it himself. */
      manualRefundCents: number;
      stripeRefundId: string | null;
      emailed: boolean;
      emailFailed: boolean;
    }
  | ({ kind: 'already-cancelled' } & LateRefund)
  | { kind: 'not-found' }
  /** Completed, no-show: not something to cancel. */
  | { kind: 'not-active'; status: Booking['status'] }
  /** The customer finished Stripe Checkout as we tried to cancel. */
  | { kind: 'paid-meanwhile' }
  /**
   * Not where the caller found it (`expect`): moved to another departure,
   * or no longer waiting on that closure. Left as it is.
   */
  | ({ kind: 'changed' } & LateRefund);

/** Where the caller found the booking when it decided to cancel it. */
export interface CancelExpectation {
  date: string;
  timeSlot: string;
  /** The closure it was waiting on, when that's why it's being cancelled. */
  closureBlackoutId?: string;
}

function asExpected(b: Booking, expect: CancelExpectation | undefined): boolean {
  if (!expect) return true;
  if (b.date !== expect.date || b.timeSlot !== expect.timeSlot) return false;
  return expect.closureBlackoutId === undefined || b.closure?.blackoutId === expect.closureBlackoutId;
}

export interface CancellationMailer {
  /**
   * `kind` is what the email log files it as; a cancellation unless said otherwise.
   * `idempotencyKey`: Resend sends a repeated request with the same key only once.
   */
  send(msg: {
    to: string;
    subject: string;
    html: string;
    text: string;
    bookingId: string;
    kind?: EmailKind;
    idempotencyKey?: string;
  }): Promise<void>;
  marina: { name: string; address: string };
  phoneDisplay: string;
}

/**
 * Travis cancelling one booking, from the booking page or by closing a day.
 *
 * Only money this site took through Stripe is refunded automatically. A
 * booking imported from the old website has no Stripe payment here, so
 * nothing is recorded as refunded: the amount is kept as `manualRefundCents`
 * (Reports and the dashboard count it as given back, not kept) and goes into
 * the private notes for Travis to refund by hand, and any email says he'll be
 * in touch about it.
 *
 * An unpaid checkout is expired at Stripe first, so it can't be paid after
 * the booking is cancelled. If it was paid in the meantime, nothing changes.
 *
 * The refund goes to Stripe before the booking is marked cancelled. If it's
 * cancelled (or, with `expect`, moved) another way in between, this one
 * doesn't cancel it, but the refund is kept on the booking with a note for
 * Travis and returned, so whoever asked can say it went out.
 */
export async function adminCancelOne(
  bookingId: string,
  opts: {
    /**
     * Stored on the booking. Shown to the customer, except one Travis typed
     * while cancelling without emailing them: the admin page tells him only
     * he sees that one.
     */
    reason: string | null;
    /** Whether to email the customer. Defaults to yes unless the booking was imported. */
    notifyCustomer?: boolean;
    cause: 'admin' | 'blackout';
    /**
     * The closure (its blackout id) cancelling this booking. Stamped on it,
     * so a closure picked up after a crash can tell the bookings it
     * cancelled from ones cancelled some other way (lib/close-day.ts).
     */
    closureId?: string;
    /**
     * Where the caller found it. A booking moved since (by Travis or the
     * customer), or no longer waiting on that closure (the day reopened),
     * isn't cancelled: `changed`. Checked before anything goes to Stripe,
     * and again as it's cancelled.
     */
    expect?: CancelExpectation;
    /** Why a closed booking is ending now, for the customer's email. */
    emailCause?: CancellationCause;
    /**
     * Who's recorded as cancelling it: Travis unless said otherwise. The
     * customer, when they took the full refund his closure offered them
     * (cancelBooking), so his booking page, MCP and his phone tell their
     * choice from the deadline's automatic refund. The refund itself goes
     * through as his, under the closure's key, either way.
     */
    cancelledBy?: 'admin' | 'customer';
  },
  deps: {
    stripe: Pick<Stripe, 'checkout' | 'refunds'>;
    mailer: CancellationMailer;
    db?: Firestore;
  },
): Promise<AdminCancelOutcome> {
  const { stripe, mailer, db = defaultDb } = deps;
  const ref = db.collection('bookings').doc(bookingId);

  const booking = (await ref.get()).data() as Booking | undefined;
  if (!booking) return { kind: 'not-found' };
  if (booking.status === 'cancelled') return { kind: 'already-cancelled' };
  if (booking.status !== 'confirmed' && booking.status !== 'pending-payment') {
    return { kind: 'not-active', status: booking.status };
  }
  if (!asExpected(booking, opts.expect)) return { kind: 'changed' };

  const legacy = isLegacyBooking({ id: bookingId, legacy: booking.legacy });

  const sessionId = booking.stripeCheckoutSessionId;
  if (!legacy && booking.status === 'pending-payment' && sessionId) {
    let session: Pick<Stripe.Checkout.Session, 'status'>;
    try {
      session = await stripe.checkout.sessions.expire(sessionId);
    } catch (err) {
      // Stripe only expires open sessions. Find out why this one wasn't.
      session = await stripe.checkout.sessions.retrieve(sessionId);
      if (session.status === 'open') throw err;
    }
    if (session.status === 'complete') return { kind: 'paid-meanwhile' };
  }

  const owed = Math.max(0, booking.amountPaidCents - (booking.amountRefundedCents ?? 0));
  const refundCents = !legacy && booking.stripePaymentIntentId ? owed : 0;
  const manualRefundCents = owed - refundCents;
  const notify = opts.notifyCustomer ?? !legacy;
  // A closure's reason ("Closed for weather") is written for the customer
  // whether or not they're emailed. Travis's own, typed with the email
  // turned off, is private: fetchBooking leaves it off their booking page.
  const reasonPrivate = opts.cause === 'admin' && !notify && !!opts.reason;

  let refund: Stripe.Refund | null = null;
  if (refundCents > 0) {
    refund = await stripe.refunds.create(
      {
        payment_intent: booking.stripePaymentIntentId!,
        amount: refundCents,
        reason: 'requested_by_customer',
        metadata: {
          bookingId,
          cancelledBy: 'admin',
          ...(opts.cause === 'blackout' ? { cause: 'blackout' } : { policyTier: 'full' }),
        },
        expand: ['charge'],
      },
      { idempotencyKey: `${opts.cause === 'blackout' ? 'blackout' : 'admin'}-cancel-${bookingId}` },
    );
  }

  const done = await db.runTransaction(async (tx) => {
    const fresh = (await tx.get(ref)).data() as Booking | undefined;
    if (!fresh) return 'already-cancelled' as const;
    const before = fresh.amountRefundedCents ?? 0;
    // Stripe's total, so a charge.refunded webhook landing first doesn't
    // count the refund twice. Money Travis refunds by hand isn't in it: it's
    // kept apart, as manualRefundCents.
    const refundedTotal = refund ? refundedTotalAfter(before, refund) : before;
    const lost = fresh.status === 'cancelled' ? 'already-cancelled' : !asExpected(fresh, opts.expect) ? 'changed' : null;
    if (lost) {
      // Cancelled or moved another way while Stripe took the refund. It
      // stands, so the booking says so, and Travis sees what happened.
      if (refund) {
        const lateNote =
          lost === 'already-cancelled'
            ? `${marinaNow().date}: Cancelled another way just as ${formatPrice(refundCents)} was refunded to cancel it here. The refund stands.`
            : `${marinaNow().date}: ${formatPrice(refundCents)} was refunded to cancel it, but it was moved or put back on its trip at the same moment, so it’s still booked. Sort out the money with the customer.`;
        tx.update(ref, {
          amountRefundedCents: refundedTotal,
          paymentStatus: refundedTotal >= fresh.amountPaidCents ? 'refunded' : 'partial-refund',
          updatedAt: FieldValue.serverTimestamp(),
          adminNotes: fresh.adminNotes ? `${fresh.adminNotes}\n${lateNote}` : lateNote,
        });
      }
      return lost;
    }
    const note =
      manualRefundCents > 0
        ? `${marinaNow().date}: Cancelled. ${formatPrice(manualRefundCents)} was paid on the old website. Refund it by hand.`
        : null;
    // A checkout nobody finished: marked failed, as when the customer
    // leaves it (releaseHold) or Stripe expires it, so Reports and the
    // dashboard leave it out like those. A payment that lands after all
    // (stripeWebhook) is refunded and recorded over it.
    const unpaidCheckout = !legacy && fresh.status === 'pending-payment' && !(fresh.amountPaidCents > 0);
    tx.update(ref, {
      status: 'cancelled',
      paymentStatus: unpaidCheckout
        ? 'failed'
        : !refund
          ? fresh.paymentStatus
          : refundedTotal >= fresh.amountPaidCents
            ? 'refunded'
            : 'partial-refund',
      amountRefundedCents: refundedTotal,
      ...(manualRefundCents > 0 ? { manualRefundCents } : {}),
      cancellationReason: opts.reason,
      ...(reasonPrivate ? { cancellationReasonPrivate: true } : {}),
      cancelledAt: FieldValue.serverTimestamp(),
      cancelledBy: opts.cancelledBy ?? 'admin',
      // What this cancel refunded, for Travis's push when it was theirs.
      ...(opts.cancelledBy === 'customer' ? { cancelRefundCents: refundCents } : {}),
      // With what this cancel refunded, so a rerun of the closure reports
      // that and not partial refunds Travis gave before it.
      ...(opts.closureId ? { cancelledByClosure: opts.closureId, closureRefundCents: refundCents } : {}),
      updatedAt: FieldValue.serverTimestamp(),
      ...(note ? { adminNotes: fresh.adminNotes ? `${fresh.adminNotes}\n${note}` : note } : {}),
    });
    return 'cancelled' as const;
  });
  if (done !== 'cancelled') return refund ? { kind: done, refundCents, stripeRefundId: refund.id } : { kind: done };

  let emailed = false;
  let emailFailed = false;
  if (notify && booking.customerEmail) {
    try {
      const refreshed = (await ref.get()).data() as Booking;
      const { subject, html, text } = buildCancellationEmail({
        booking: refreshed,
        refundCents,
        refundPercent: 100,
        cancelledBy: 'admin',
        reason: opts.reason ?? undefined,
        marina: mailer.marina,
        phoneDisplay: mailer.phoneDisplay,
        manualRefundCents,
        previouslyRefundedCents: booking.amountRefundedCents ?? 0,
        cause: opts.emailCause,
      });
      await mailer.send({ to: refreshed.customerEmail, subject, html, text, bookingId });
      emailed = true;
    } catch (err) {
      emailFailed = true;
      logger.error('Admin cancellation email failed', { bookingId, err });
    }
  }

  return { kind: 'cancelled', refundCents, manualRefundCents, stripeRefundId: refund?.id ?? null, emailed, emailFailed };
}

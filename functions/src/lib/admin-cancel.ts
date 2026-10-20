import { logger } from 'firebase-functions/v2';
import type { Firestore } from 'firebase-admin/firestore';
import type Stripe from 'stripe';

import { db as defaultDb, FieldValue } from './firebase';
import { buildCancellationEmail, type CancellationCause } from './email-templates';
import { isEmailSendError, type EmailKind } from './email-log';
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
      /**
       * With `refundHandledInStripe`: what was owed back, given back in
       * Stripe (a dispute, or a refund there) and recorded as refunded by
       * hand. 0 otherwise.
       */
      handledInStripeCents: number;
      stripeRefundId: string | null;
      emailed: boolean;
      emailFailed: boolean;
      /**
       * Resend turned the email away for good (an address it won't send to):
       * recorded as a bounce on the booking instead of being tried again.
       */
      emailRejected: boolean;
      /** A checkout nobody finished, as this cancel found it: nothing had been paid. */
      unpaidCheckout: boolean;
    }
  | ({ kind: 'already-cancelled' } & LateRefund)
  | { kind: 'not-found' }
  /** Completed, no-show: not something to cancel. */
  | { kind: 'not-active'; status: Booking['status'] }
  /**
   * The customer finished Stripe Checkout as we tried to cancel, or (with
   * `onlyUnpaid`) before we got to it.
   */
  | { kind: 'paid-meanwhile' }
  /** `refundHandledInStripe`, but Stripe hasn't turned down a refund for this booking. */
  | { kind: 'no-refused-refund' }
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

/**
 * Stripe turned down the full refund Travis's Cancel sent (a disputed
 * payment, say), kept by {@link keepRefusedCancelRefund}.
 */
interface RefusedCancelRefund {
  cancelRefundRefused?: { at: unknown; refundCents: number; stripeMessage: string };
}

/**
 * Stripe has turned down a refund for cancelling this booking: the one due
 * at its closure's deadline (settleClosedBookings), or Travis's own Cancel.
 */
function refundWasRefused(b: Booking & RefusedCancelRefund): boolean {
  return !!b.closure?.refundRefused || !!b.cancelRefundRefused;
}

/**
 * Stripe turning a refund down (the payment is too old to refund, or
 * disputed), as cancelBooking's refundRefused tells it, as opposed to not
 * answering. Not Stripe's 409, another request refunding under the same key
 * at that moment.
 */
export function stripeRefusedRefund(err: unknown): err is Error {
  const e = err as { type?: unknown; statusCode?: unknown; code?: unknown } | null;
  if (!(err instanceof Error) || e?.statusCode === 409 || e?.code === 'idempotency_key_in_use') return false;
  return e?.type === 'StripeInvalidRequestError' || e?.type === 'StripeCardError';
}

/**
 * Stripe turned down the refund Travis's Cancel sent: adminCancelOne
 * refunds before it writes, so nothing else changed. Kept on the booking
 * (`cancelRefundRefused`), so its Cancel offers "refund handled in Stripe"
 * from then on, as it does for a deadline refund Stripe turned down.
 * `already-cancelled`: cancelled another way just then (the customer's own
 * refund got there first, which is why Stripe said no).
 */
export async function keepRefusedCancelRefund(
  bookingId: string,
  stripeMessage: string,
  deps: { db?: Firestore } = {},
): Promise<'kept' | 'already-cancelled' | 'not-found'> {
  const db = deps.db ?? defaultDb;
  const ref = db.collection('bookings').doc(bookingId);
  return db.runTransaction(async (tx) => {
    const fresh = (await tx.get(ref)).data() as Booking | undefined;
    if (!fresh) return 'not-found' as const;
    if (fresh.status === 'cancelled') return 'already-cancelled' as const;
    tx.update(ref, {
      cancelRefundRefused: {
        at: FieldValue.serverTimestamp(),
        refundCents: Math.max(0, fresh.amountPaidCents - (fresh.amountRefundedCents ?? 0)),
        stripeMessage,
      },
    });
    return 'kept' as const;
  });
}

/**
 * Resend turned the email away for good because of the address: a
 * `validation_error` about the `to` field ("Invalid `to` field…"), an
 * address it won't send to (old-site imports weren't checked). Trying
 * again, an hour or a day later, gets the same answer. Resend also uses
 * `validation_error` for trouble on our side that every recipient hits
 * (the sending domain isn't verified, a testing-only sender): that isn't
 * the customer's address, and it sends once the sender is fixed, so it
 * stays on the hourly retry.
 */
export function emailRefusedForGood(err: unknown): boolean {
  return isEmailSendError(err, 'validation_error') && /`to`/i.test(err.message);
}

/**
 * Records a cancellation email Resend turned away for good as a permanent
 * bounce on the booking (`emailBounces.cancellation`), as a bounce from the
 * Resend webhook is: the booking page flags it and shows the address, to
 * check with the customer ("Fix email and resend"). Nothing tries it again.
 * `extra`: other fields to write with it.
 */
export async function recordRefusedCancellationEmail(
  db: Firestore,
  bookingId: string,
  sent: { to: string; subject: string; err: unknown },
  extra: Record<string, unknown> = {},
): Promise<void> {
  const reason = sent.err instanceof Error ? sent.err.message : String(sent.err);
  await db
    .collection('bookings')
    .doc(bookingId)
    .update({
      ...extra,
      'emailBounces.cancellation': {
        // It never left, so there's no Resend email id: one for this send.
        emailId: `refused/${cancellationEmailKey(bookingId)}`,
        to: sent.to,
        subject: sent.subject,
        bounceType: 'Permanent',
        bounceMessage: reason,
        at: FieldValue.serverTimestamp(),
      },
      updatedAt: FieldValue.serverTimestamp(),
    })
    .catch((err) => logger.error('Couldn’t record a cancellation email Resend refused for good', { bookingId, err }));
}

function asExpected(b: Booking, expect: CancelExpectation | undefined): boolean {
  if (!expect) return true;
  if (b.date !== expect.date || b.timeSlot !== expect.timeSlot) return false;
  return expect.closureBlackoutId === undefined || b.closure?.blackoutId === expect.closureBlackoutId;
}

/**
 * The cancellation email's Resend idempotency key: one per booking, since
 * a booking is cancelled once. A resend after an unknown outcome
 * (resendDeadlineEmails) uses it too, so it can't go twice.
 */
export function cancellationEmailKey(bookingId: string): string {
  return `cancellation/${bookingId}`;
}

/**
 * A closure's cancellation email Resend refused, with nobody watching:
 * what it says, kept on the booking (`deadlineEmail`) until the hourly
 * closure run sends it (resendDeadlineEmails in settleClosedBookings.ts).
 * `cause`: the closure going out cancelled it; missing, the deadline did.
 */
export interface UnsentCancellationEmail {
  sent: false;
  refundCents: number;
  manualRefundCents: number;
  previouslyRefundedCents: number;
  cause?: 'trip-closed';
}

/** Keeps an {@link UnsentCancellationEmail} on the booking. A failure is logged; the cancel stands either way. */
export async function keepUnsentCancellationEmail(db: Firestore, bookingId: string, unsent: UnsentCancellationEmail): Promise<void> {
  await db
    .collection('bookings')
    .doc(bookingId)
    .update({ deadlineEmail: unsent })
    .catch((err) => logger.error('A closure’s cancellation email failed and couldn’t be kept to send again', { bookingId, err }));
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
    /**
     * Only an unfinished checkout on this site is to be cancelled: a closure
     * offering a new date cancels those, having nothing to offer them. One
     * paid since the caller looked (Stripe's webhook confirmed it) comes back
     * `paid-meanwhile` before anything goes to Stripe, for the caller to
     * offer them a new date instead.
     */
    onlyUnpaid?: boolean;
    /**
     * Stripe turned down this booking's refund (its deadline's, or an
     * earlier Cancel's), and the money went back to them in Stripe: a
     * dispute, or a refund Travis made there. Nothing goes to Stripe; what
     * was still owed back is recorded as refunded by hand
     * (`manualRefundCents`, `manualRefundedAt`), so Reports count it as
     * given back, with a note. Any email says their payment has been
     * refunded. `no-refused-refund` for a booking whose refund Stripe hasn't
     * turned down: Cancel refunds those.
     */
    refundHandledInStripe?: boolean;
  },
  deps: {
    stripe: Pick<Stripe, 'checkout' | 'refunds'>;
    mailer: CancellationMailer;
    db?: Firestore;
  },
): Promise<AdminCancelOutcome> {
  const { stripe, mailer, db = defaultDb } = deps;
  const ref = db.collection('bookings').doc(bookingId);

  const booking = (await ref.get()).data() as (Booking & RefusedCancelRefund) | undefined;
  if (!booking) return { kind: 'not-found' };
  if (booking.status === 'cancelled') return { kind: 'already-cancelled' };
  if (booking.status !== 'confirmed' && booking.status !== 'pending-payment') {
    return { kind: 'not-active', status: booking.status };
  }
  if (!asExpected(booking, opts.expect)) return { kind: 'changed' };
  const handled = !!opts.refundHandledInStripe;
  if (handled && !refundWasRefused(booking)) return { kind: 'no-refused-refund' };

  const legacy = isLegacyBooking({ id: bookingId, legacy: booking.legacy });
  // Paid since the caller looked: no longer an unfinished checkout to drop.
  if (opts.onlyUnpaid && !(booking.status === 'pending-payment' && !legacy)) return { kind: 'paid-meanwhile' };

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
  const refundCents = !handled && !legacy && booking.stripePaymentIntentId ? owed : 0;
  // For Travis to refund himself. Not money already given back in Stripe.
  const manualRefundCents = handled ? 0 : owed - refundCents;
  // Given back in Stripe: what's still owed as the cancel is written.
  let handledInStripeCents = 0;
  // Not one given back in Stripe either, unless Travis asks: the
  // customer knows how their money came back better than this site does.
  const notify = opts.notifyCustomer ?? (!legacy && !handled);
  // A closure's reason ("Closed for weather") is written for the customer
  // whether or not they're emailed. Travis's own, typed with the email
  // turned off, is private: fetchBooking leaves it off their booking page.
  const reasonPrivate = opts.cause === 'admin' && !notify && !!opts.reason;

  let refund: Stripe.Refund | null = null;
  let unpaidCheckout = false;
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
    // Confirmed by Stripe's webhook since it was read above.
    if (opts.onlyUnpaid && fresh.status !== 'pending-payment') return 'paid-meanwhile' as const;
    // Moved (its closure's refusal goes with the closure) since it was read.
    if (handled && !refundWasRefused(fresh)) return 'changed' as const;
    // A refund Travis made in Stripe's dashboard is already in
    // amountRefundedCents (stripeWebhook): only the rest is recorded here.
    handledInStripeCents = handled ? Math.max(0, fresh.amountPaidCents - before) : 0;
    const note = handled
      ? `${marinaNow().date}: Cancelled with the refund handled in Stripe (a dispute or a refund there): Stripe had turned the refund down, so none went from here.` +
        (handledInStripeCents > 0 ? ` ${formatPrice(handledInStripeCents)} recorded as refunded by hand.` : '')
      : manualRefundCents > 0
        ? `${marinaNow().date}: Cancelled. ${formatPrice(manualRefundCents)} was paid on the old website. Refund it by hand.`
        : null;
    // A checkout nobody finished: marked failed, as when the customer
    // leaves it (releaseHold) or Stripe expires it, so Reports and the
    // dashboard leave it out like those. A payment that lands after all
    // (stripeWebhook) is refunded and recorded over it.
    unpaidCheckout = !legacy && fresh.status === 'pending-payment' && !(fresh.amountPaidCents > 0);
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
      // Already given back, outside this site: Reports count it, and
      // nothing is left owing.
      ...(handledInStripeCents > 0
        ? { manualRefundCents: handledInStripeCents, manualRefundedAt: FieldValue.serverTimestamp() }
        : {}),
      cancellationReason: opts.reason,
      ...(reasonPrivate ? { cancellationReasonPrivate: true } : {}),
      cancelledAt: FieldValue.serverTimestamp(),
      cancelledBy: opts.cancelledBy ?? 'admin',
      // Only unpaid checkouts count against the visitor (lib/checkout-limit.ts).
      checkoutIpHash: FieldValue.delete(),
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
  if (done === 'paid-meanwhile') return { kind: done };
  if (done !== 'cancelled') return refund ? { kind: done, refundCents, stripeRefundId: refund.id } : { kind: done };

  let emailed = false;
  let emailFailed = false;
  let emailRejected = false;
  if (notify && booking.customerEmail) {
    let sending: { to: string; subject: string } | null = null;
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
      sending = { to: refreshed.customerEmail, subject };
      await mailer.send({ to: refreshed.customerEmail, subject, html, text, bookingId, idempotencyKey: cancellationEmailKey(bookingId) });
      emailed = true;
    } catch (err) {
      emailFailed = true;
      logger.error('Admin cancellation email failed', { bookingId, err });
      if (sending && emailRefusedForGood(err)) {
        emailRejected = true;
        await recordRefusedCancellationEmail(db, bookingId, { ...sending, err });
      }
    }
  }

  return {
    kind: 'cancelled',
    refundCents,
    manualRefundCents,
    handledInStripeCents,
    stripeRefundId: refund?.id ?? null,
    emailed,
    emailFailed,
    emailRejected,
    unpaidCheckout,
  };
}

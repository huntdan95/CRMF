import { onRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import type { Firestore } from 'firebase-admin/firestore';
import type Stripe from 'stripe';
import { z } from 'zod';

import { db, FieldValue } from './lib/firebase';
import {
  releaseHold,
  type CheckoutHold,
  type ReleaseOutcome,
} from './lib/checkout-hold';
import {
  STRIPE_SECRET_KEY,
  getStripe,
  refundedTotalAfter,
} from './lib/stripe';
import { RESEND_API_KEY, RESEND_FROM_EMAIL } from './lib/resend';
import { ADMIN_EMAIL, APP_BASE_URL } from './lib/config';
import { formatPrice, getTourBySlug } from './lib/tours';
import { quoteCustomerRefund, type RefundQuote } from './lib/datetime';
import { buildCancellationEmail } from './lib/email-templates';
import { actions, button, card, details, emailPage, escape, heading, link, notice, para } from './lib/email-layout';
import { isEmailSendError, sendEmail, type EmailDeps } from './lib/email-log';
import { phoneHref, tripLabel } from './lib/bounce-alert';
import { guestsLabel } from './lib/trip-format';
import { adminCancelOne, type CancellationMailer } from './lib/admin-cancel';
import { customerMailer } from './lib/customer-mailer';
import { awaitingMove } from './lib/closure';
import { closedDeparturesOn, closesSlot, closurePendingFor, closurePendingMessage } from './lib/close-day';
import {
  applyCors,
  badRequest,
  methodNotAllowed,
  serverError,
} from './lib/http';
import { isLegacyBooking, type Blackout, type Booking, type ClosureChoice } from './lib/types';
import { hoursUntilTour, marinaNow } from './lib/datetime';
import { SLOT_MINUTES, slotStartTime } from './lib/schedule';
import { alertCrewOfCancellation } from './crewAlerts';

const PHONE_DISPLAY = '352-586-7792';

/**
 * Why a customer can't cancel a trip on a departure Travis has closed but
 * left them booked on ("leave them booked", or a day closed from MCP, which
 * only stops new bookings): he's contacting them himself. In the words of
 * closurePendingMessage's for "leave them booked" during the undo window.
 */
const DEPARTURE_CLOSED = `Capt. Travis has closed this trip and will be in touch with you directly. You can also call or text him at ${PHONE_DISPLAY}.`;

/** What the customer sees when Stripe turns their refund down; Travis gets {@link sendRefundRefusedAlert}. */
const REFUND_REFUSED = `We couldn’t send your refund back to your card, so your booking hasn’t been cancelled. Capt. Travis has been told and will be in touch to sort it out. You can also call or text him at ${PHONE_DISPLAY}.`;

/**
 * Stripe turning a refund down (the payment is too old to refund, or
 * disputed, say), as opposed to not answering. Trying again won't change
 * it, and the customer can't fix it: Travis has to.
 */
function refundRefused(err: unknown): err is Error {
  const type = (err as { type?: unknown } | null)?.type;
  return err instanceof Error && (type === 'StripeInvalidRequestError' || type === 'StripeCardError');
}

const requestSchema = z.object({
  bookingId: z.string().min(1).max(64),
  accessToken: z.string().min(8).max(64),
  reason: z.string().trim().max(500).optional(),
  /**
   * The refund the customer's dialog showed them. Optional, so a page loaded
   * before this field existed can still cancel.
   */
  expectedRefundCents: z.number().int().min(0).optional(),
});

/**
 * POST /cancelBooking
 *
 * Customer self-service cancellation. Token-authenticated. Applies the
 * policy (72h+ = full refund, under 72h = no refund; in full until
 * `refundGraceUntil` on a trip Travis reopened after offering a refund) and
 * processes any owed refund via Stripe: see {@link cancelPaidBooking}. If
 * that refund is less than the `expectedRefundCents` the dialog showed,
 * nothing is cancelled: a 409 with code `refund-changed` carries the new
 * refund, so the customer sees it and can confirm again.
 *
 * A paid booking on a departure Travis has closed isn't cancelled under the
 * policy: while he's closing it, a 409 `closure-pending`; once he has, with
 * a closure on the booking, the full refund it offered; and with none (he
 * left them booked), a 409 `departure-closed`, since he's contacting them
 * himself. Not while a reopened trip's full refund still stands: that
 * cancel goes ahead, in full.
 *
 * A booking that hasn't been paid for yet goes through
 * {@link cancelUnpaidBooking} instead.
 */
export const cancelBooking = onRequest(
  {
    cors: false,
    secrets: [
      STRIPE_SECRET_KEY,
      RESEND_API_KEY,
      RESEND_FROM_EMAIL,
      APP_BASE_URL,
    ],
    maxInstances: 10,
  },
  async (req, res) => {
    if (applyCors(req, res)) return;
    if (req.method !== 'POST') {
      methodNotAllowed(res, ['POST']);
      return;
    }

    const parsed = requestSchema.safeParse(req.body);
    if (!parsed.success) {
      badRequest(res, 'Invalid input', parsed.error.format());
      return;
    }
    const { bookingId, accessToken, reason, expectedRefundCents } = parsed.data;

    const ref = db.collection('bookings').doc(bookingId);
    const snap = await ref.get();
    if (!snap.exists) {
      res.status(404).json({ error: 'Booking not found' });
      return;
    }

    const booking = snap.data() as Booking;
    if (booking.accessToken !== accessToken) {
      res.status(403).json({ error: 'Invalid access token' });
      return;
    }

    if (booking.status === 'cancelled') {
      res.status(200).json(alreadyCancelled(booking));
      return;
    }

    // Travis closed this departure and offered a refund: it's in full,
    // whatever the policy window, and still on offer after the tour date
    // until the offer runs out. Old-site money is refunded by Travis.
    if (awaitingMove(booking)) {
      try {
        const outcome = await adminCancelOne(
          bookingId,
          {
            reason: booking.closure!.reason,
            notifyCustomer: true,
            cause: 'blackout',
            // Not if Travis moves it, or reopens the day, as they tap.
            expect: { date: booking.date, timeSlot: booking.timeSlot, closureBlackoutId: booking.closure!.blackoutId },
            emailCause: 'refund-chosen',
          },
          { stripe: getStripe(), mailer: customerMailer() },
        );
        if (outcome.kind === 'cancelled') {
          res.status(200).json({
            ok: true,
            refundCents: outcome.refundCents,
            manualRefundCents: outcome.manualRefundCents,
            refundPercent: 100,
            policyTier: 'full',
            stripeRefundId: outcome.stripeRefundId,
          });
          return;
        }
        if (outcome.kind === 'already-cancelled') {
          const fresh = (await ref.get()).data() as Booking;
          res.status(200).json(alreadyCancelled(fresh));
          return;
        }
        res.status(409).json({ error: 'This booking just changed. Reload the page to see where it stands.' });
      } catch (err) {
        logger.error('Closure refund failed', { bookingId, err });
        if (refundRefused(err)) {
          // adminCancelOne refunds before it writes, so nothing changed.
          await refusedRefund(res, {
            booking: { ...booking, id: bookingId },
            refundCents: Math.max(0, booking.amountPaidCents - (booking.amountRefundedCents ?? 0)),
            stripeMessage: err.message,
          });
          return;
        }
        serverError(res, err);
      }
      return;
    }
    if (booking.status === 'completed' || booking.status === 'no-show') {
      res.status(409).json({
        error: 'Tours that have already happened can\'t be cancelled.',
      });
      return;
    }
    // Travis has just closed this departure and its undo window is still
    // open: the policy refund (half, or nothing, close to the day) would be
    // less than the full refund the closure is about to give them.
    const pendingClosure = await closurePendingFor(db, booking.date, booking.timeSlot);
    if (pendingClosure) {
      res.status(409).json({ error: closurePendingMessage(pendingClosure.choice), code: 'closure-pending' });
      return;
    }
    // Still "confirmed" because Travis hasn't marked it yet, but the boat
    // has left: cancelling now would only drop it from his records, the
    // manifest and the stats.
    const departs = booking.timeSlot in SLOT_MINUTES ? slotStartTime(booking.timeSlot, booking.date) : undefined;
    if (
      booking.date < marinaNow().date ||
      (departs !== undefined && hoursUntilTour(booking.date, departs) < 0)
    ) {
      res.status(409).json({
        error: 'Tours that have already happened can\'t be cancelled.',
      });
      return;
    }

    // Booked on the old website: the money isn't in this site's Stripe, so a
    // refund can't be worked out or sent from here. Travis handles these.
    if (isLegacyBooking({ id: bookingId, legacy: booking.legacy })) {
      res.status(409).json({
        error: `This booking was made on our old website, so it can't be cancelled online. Please call or text Travis at ${PHONE_DISPLAY} and he'll sort it out.`,
      });
      return;
    }

    // Not paid for yet: the Stripe Checkout session may still be open.
    // No cancellation email, since they were never charged or confirmed.
    if (booking.status === 'pending-payment') {
      try {
        const result = await cancelUnpaidBooking(
          { bookingId, accessToken },
          reason,
          { stripe: getStripe() },
        );
        logger.info('Cancelled unpaid booking', {
          bookingId,
          outcome: result.outcome,
        });
        res.status(result.status).json(result.body);
      } catch (err) {
        logger.error('Could not cancel unpaid booking', { bookingId, err });
        serverError(res, err);
      }
      return;
    }

    // Travis closed this departure and left them booked: once the undo
    // window is over there's no closure on the booking, but the policy
    // refund (nothing, close to the day) still isn't what a trip he closed
    // gets. He's sorting it out with them, as the window's 409 says.
    if (!inRefundGrace(booking) && (await closedDeparturesOn(db, booking.date))(booking.timeSlot)) {
      res.status(409).json({ error: DEPARTURE_CLOSED, code: 'departure-closed' });
      return;
    }

    const tour = await getTourBySlug(booking.tourId);
    if (!tour) {
      logger.error(`Tour ${booking.tourId} missing for booking ${bookingId}`);
      res.status(500).json({ error: 'Tour record missing — call Travis.' });
      return;
    }

    let result: Awaited<ReturnType<typeof cancelPaidBooking>>;
    try {
      result = await cancelPaidBooking(
        bookingId,
        booking,
        { reason, startTime: slotStartTime(booking.timeSlot, booking.date), expectedRefundCents },
        { stripe: getStripe(), mailer: customerMailer() },
      );
    } catch (err) {
      serverError(res, err);
      return;
    }

    if (result.kind === 'already-cancelled') {
      const fresh = (await ref.get()).data() as Booking;
      res.status(200).json(alreadyCancelled(fresh));
      return;
    }
    if (result.kind === 'closure-pending') {
      res.status(409).json({ error: closurePendingMessage(result.choice), code: 'closure-pending' });
      return;
    }
    if (result.kind === 'departure-closed') {
      res.status(409).json({ error: DEPARTURE_CLOSED, code: 'departure-closed' });
      return;
    }
    if (result.kind === 'refund-refused') {
      await refusedRefund(res, {
        booking: { ...booking, id: bookingId },
        refundCents: result.refundCents,
        stripeMessage: result.stripeMessage,
      });
      return;
    }
    if (result.kind === 'refund-changed') {
      const { quote } = result;
      logger.info('Refund dropped below what the customer was shown', {
        bookingId,
        expectedRefundCents,
        refundCents: quote.refundCents,
      });
      res.status(409).json({
        error: `Your refund is now ${formatPrice(quote.refundCents)}, not the ${formatPrice(expectedRefundCents ?? 0)} shown. Nothing has been cancelled: confirm again if you still want to cancel.`,
        code: 'refund-changed',
        refundCents: quote.refundCents,
        refundPercent: quote.refundPercent,
        policyTier: quote.tier,
        explanation: quote.explanation,
      });
      return;
    }

    // Tell the crew. Never undoes the cancellation; retryCrewAlerts picks
    // up a failed send.
    try {
      const alert = await alertCrewOfCancellation(bookingId);
      logger.info('Crew cancellation alert', { bookingId, alert });
    } catch (err) {
      logger.error('Crew cancellation alert failed', { bookingId, err });
    }

    res.status(200).json({
      ok: true,
      refundCents: result.quote.refundCents,
      refundPercent: result.quote.refundPercent,
      policyTier: result.quote.tier,
      stripeRefundId: result.refundId,
    });
  },
);

/**
 * Cancels a paid booking under the refund policy. The policy percentage
 * applies to what's left of the payment after any refund Travis already
 * gave, so Stripe is never asked for more than remains.
 *
 * The Stripe refund goes first, under a key that's the same on every retry
 * so it never refunds twice. The booking is marked cancelled only after
 * Stripe has taken the refund, so a Stripe failure leaves it unchanged:
 * Stripe not answering throws, and Stripe turning the refund down returns
 * `refund-refused` for the caller to tell the customer and Travis. An
 * email failure doesn't undo the cancellation.
 *
 * If an earlier try got the refund through but then failed to mark the
 * booking cancelled, a retry settles on that refund instead of quoting
 * again. The tour may have come within 72 hours since, and Stripe
 * refuses a new amount under the same key every time (or, once it forgets
 * the key a day later, refunds it on top of the first).
 *
 * A fresh quote lower than `expectedRefundCents` (what the customer was
 * shown) cancels nothing: the dialog may have sat open across the 72-hour
 * line, or run on a wrong clock. A refund already in Stripe from an earlier
 * try isn't held back that way; the money has moved, so the booking is
 * cancelled to match.
 *
 * The caller checks first that Travis isn't closing this departure
 * (closurePendingFor), and hasn't closed it and left them booked (a
 * blackout covers it, outside a reopened trip's refund grace). He may
 * confirm a closure just as this runs, so the cancel checks both again as
 * it's written, and stops if he has: the closure refunds them in full, or
 * he's sorting it out with them. Again, not once a refund has gone to
 * Stripe. If someone else cancelled the booking meanwhile, it's left as
 * they did it, and the customer isn't emailed: theirs is the cancellation
 * that counts.
 */
export async function cancelPaidBooking(
  bookingId: string,
  booking: Booking,
  opts: {
    reason: string | undefined;
    /** The tour's `HH:MM` start time. */
    startTime: string;
    /** The refund the customer was shown. */
    expectedRefundCents?: number;
    now?: Date;
  },
  deps: {
    stripe: Pick<Stripe, 'refunds'>;
    mailer: CancellationMailer;
    db?: Firestore;
  },
): Promise<
  | { kind: 'cancelled'; quote: CustomerRefund; refundId: string | null }
  /** Less than the customer was shown. Nothing changed. */
  | { kind: 'refund-changed'; quote: RefundQuote }
  /** Cancelled another way first (Travis, say). */
  | { kind: 'already-cancelled' }
  /** Travis is closing this departure. Nothing changed. */
  | { kind: 'closure-pending'; choice: ClosureChoice }
  /** Travis closed this departure and left them booked. Nothing changed. */
  | { kind: 'departure-closed' }
  /** Stripe turned the refund down (`stripeMessage` says why). Nothing changed. */
  | { kind: 'refund-refused'; refundCents: number; stripeMessage: string }
> {
  const ref = (deps.db ?? db).collection('bookings').doc(bookingId);
  const paymentIntentId = booking.stripePaymentIntentId;

  let refund = paymentIntentId
    ? await findCancelRefund(deps.stripe, paymentIntentId, bookingId)
    : null;
  let quote: CustomerRefund;
  let earlierRefundCents: number;
  if (refund) {
    // 'half' only on refunds made under the old 24–72-hour 50% tier.
    const tier = refund.metadata?.policyTier === 'half' ? 'half' : 'full';
    quote = { tier, refundPercent: tier === 'half' ? 50 : 100, refundCents: refund.amount };
    // What had been refunded before this one. The booking may count this
    // one already, if Stripe's webhook got to it.
    earlierRefundCents =
      refund.charge && typeof refund.charge === 'object'
        ? Math.max(0, refund.charge.amount_refunded - refund.amount)
        : (booking.amountRefundedCents ?? 0);
  } else {
    earlierRefundCents = booking.amountRefundedCents ?? 0;
    const fresh = quoteCustomerRefund({
      amountPaidCents: booking.amountPaidCents,
      amountRefundedCents: earlierRefundCents,
      date: booking.date,
      startTime: opts.startTime,
      now: opts.now,
      // Travis reopened their trip after offering a refund: in full until
      // that offer's deadline. The dialog's preview applies the same.
      refundGraceUntil: booking.refundGraceUntil,
    });
    if (opts.expectedRefundCents !== undefined && fresh.refundCents < opts.expectedRefundCents) {
      return { kind: 'refund-changed', quote: fresh };
    }
    quote = fresh;
    if (quote.refundCents > 0 && paymentIntentId) {
      try {
        refund = await deps.stripe.refunds.create(
          {
            payment_intent: paymentIntentId,
            amount: quote.refundCents,
            reason: 'requested_by_customer',
            metadata: {
              bookingId,
              cancelledBy: 'customer',
              policyTier: quote.tier,
            },
            expand: ['charge'],
          },
          {
            idempotencyKey: `cancel-${bookingId}`,
          },
        );
      } catch (err) {
        logger.error('Stripe refund failed', { bookingId, err });
        if (refundRefused(err)) {
          return { kind: 'refund-refused', refundCents: quote.refundCents, stripeMessage: err.message };
        }
        throw err;
      }
    }
  }
  const refundId = refund?.id ?? null;

  // A transaction, so a concurrent admin edit or refund isn't trampled.
  let written: 'cancelled' | 'raced' | 'closed' | { closurePending: ClosureChoice };
  try {
    written = await (deps.db ?? db).runTransaction(async (tx) => {
      const current = (await tx.get(ref)).data() as Booking;
      if (current.status === 'cancelled') return 'raced' as const;
      if (!refund) {
        const pending = await closurePendingFor(deps.db ?? db, current.date, current.timeSlot, tx);
        if (pending) return { closurePending: pending.choice };
        if (!inRefundGrace(current, opts.now)) {
          const onDay = await tx.get((deps.db ?? db).collection('blackouts').where('date', '==', current.date));
          if (onDay.docs.some((d) => closesSlot((d.data() as Blackout).affectedSlots, current.timeSlot))) {
            return 'closed' as const;
          }
        }
      }
      const before = current.amountRefundedCents ?? 0;
      // Stripe's total, so a charge.refunded webhook landing first doesn't
      // count the refund twice.
      const refundedTotal = refund
        ? refundedTotalAfter(before, refund)
        : before + quote.refundCents;
      tx.update(ref, {
        status: 'cancelled',
        paymentStatus:
          quote.refundCents === 0
            ? current.paymentStatus
            : refundedTotal >= current.amountPaidCents
              ? 'refunded'
              : 'partial-refund',
        amountRefundedCents: refundedTotal,
        // This cancel's own refund, for the crew alert and Travis's push.
        cancelRefundCents: quote.refundCents,
        cancellationReason: opts.reason ?? null,
        cancelledAt: FieldValue.serverTimestamp(),
        cancelledBy: 'customer',
        updatedAt: FieldValue.serverTimestamp(),
      });
      return 'cancelled' as const;
    });
  } catch (err) {
    logger.error('Firestore cancellation write failed', {
      bookingId,
      refundId,
      err,
    });
    throw err;
  }
  if (written === 'raced') {
    if (refundId) logger.warn('Cancelled another way as the customer’s refund went through', { bookingId, refundId });
    return { kind: 'already-cancelled' };
  }
  if (written === 'closed') return { kind: 'departure-closed' };
  if (written !== 'cancelled') return { kind: 'closure-pending', choice: written.closurePending };

  try {
    const refreshed = (await ref.get()).data() as Booking;
    const { subject, html, text } = buildCancellationEmail({
      booking: refreshed,
      refundCents: quote.refundCents,
      refundPercent: quote.refundPercent,
      cancelledBy: 'customer',
      reason: opts.reason,
      marina: deps.mailer.marina,
      phoneDisplay: deps.mailer.phoneDisplay,
      previouslyRefundedCents: earlierRefundCents,
    });
    await deps.mailer.send({ to: refreshed.customerEmail, subject, html, text, bookingId });
  } catch (err) {
    logger.error('Cancellation email failed', { bookingId, err });
  }

  return { kind: 'cancelled', quote, refundId };
}

/** Stripe turned a customer's cancel refund down: Travis hears, and the customer is told he will. */
async function refusedRefund(res: import('express').Response, alert: RefundRefusedAlert): Promise<void> {
  try {
    await sendRefundRefusedAlert(alert);
  } catch (err) {
    logger.error('Refund-refused alert to Travis failed', { bookingId: alert.booking.id, err });
  }
  res.status(409).json({ error: REFUND_REFUSED, code: 'refund-refused' });
}

export interface RefundRefusedAlert {
  booking: Booking & { id: string };
  /** What they were due back. */
  refundCents: number;
  /** Stripe's reason. */
  stripeMessage: string;
}

/**
 * To Travis when Stripe turns down the refund a customer's cancel was due:
 * who, what they were due, Stripe's reason, a tap-to-call link and the
 * booking in admin. Nothing was cancelled.
 */
export function buildRefundRefusedEmail(alert: RefundRefusedAlert, baseUrl: string) {
  const b = alert.booking;
  const name = b.customerName || 'A customer';
  const trip = tripLabel(b);
  const amount = formatPrice(alert.refundCents);
  const adminUrl = `${baseUrl.replace(/\/$/, '')}/admin/bookings/${encodeURIComponent(b.id)}`;
  const tel = b.customerPhone ? phoneHref(b.customerPhone) : null;

  const subject = `[CRMF] Refund refused: call ${b.customerName || 'the customer'} (${trip})`;
  const lead = `${name} tried to cancel their booking online, but Stripe turned down the ${amount} refund they were due: “${alert.stripeMessage}”`;
  const next =
    'Nothing has been cancelled or refunded. They’ve been told you’ll be in touch. Give them a call; the payment in Stripe’s dashboard shows why it can’t be refunded.';

  const text = [
    lead,
    '',
    next,
    '',
    `Phone:   ${b.customerPhone || 'not given'}${tel ? ` (${tel})` : ''}`,
    `Trip:    ${trip} · ${b.tourName}, ${guestsLabel(b.guestCount)}`,
    `Due:     ${amount}`,
    '',
    `Open the booking: ${adminUrl}`,
  ].join('\n');

  const html = emailPage({
    title: subject,
    preheader: `${name}: ${amount} not refunded`,
    body: [
      heading('Refund refused'),
      para(escape(lead), { large: true }),
      notice(
        `${para(escape(next), { margin: '0' })}${
          tel
            ? actions(button(tel, `Call ${name}: ${b.customerPhone}`))
            : para('No phone number on the booking.', { soft: true, margin: '12px 0 0' })
        }`,
      ),
      card(
        details([
          ['Phone', tel ? link(tel, b.customerPhone) : escape(b.customerPhone || 'Not given')],
          ['Trip', `${escape(trip)}<br/>${escape(b.tourName)}, ${escape(guestsLabel(b.guestCount))}`],
          ['Due', escape(amount)],
        ]),
        { table: true },
      ),
      para(link(adminUrl, 'Open the booking in admin'), { margin: '0' }),
    ].join('\n'),
  });

  return { subject, html, text };
}

/**
 * Emails {@link buildRefundRefusedEmail} to Travis, once a day per booking
 * however many times the customer taps (Resend's idempotency key; a second
 * send that differs is turned away as `invalid_idempotent_request`).
 */
export async function sendRefundRefusedAlert(
  alert: RefundRefusedAlert,
  deps: EmailDeps & { baseUrl?: string; adminEmail?: string } = {},
): Promise<void> {
  const { subject, html, text } = buildRefundRefusedEmail(alert, deps.baseUrl ?? APP_BASE_URL.value());
  try {
    await sendEmail(
      {
        kind: 'admin',
        bookingId: alert.booking.id,
        to: deps.adminEmail ?? ADMIN_EMAIL.value(),
        subject,
        html,
        text,
        replyTo: alert.booking.customerEmail,
        headers: { 'X-Entity-Ref-ID': alert.booking.id },
        idempotencyKey: `refund-refused/${alert.booking.id}`,
      },
      deps,
    );
  } catch (err) {
    if (
      isEmailSendError(err, 'invalid_idempotent_request') ||
      isEmailSendError(err, 'concurrent_idempotent_requests')
    ) {
      return;
    }
    throw err;
  }
}

/** What the customer gets back, and under which part of the policy. */
type CustomerRefund = Pick<RefundQuote, 'tier' | 'refundCents' | 'refundPercent'>;

/**
 * A trip Travis reopened after offering a refund, still before that offer's
 * deadline (marina time), as quoteCustomerRefund reads it. They were
 * promised a full refund until then in writing, so a closed day doesn't
 * stop that cancel: it refunds everything anyway.
 */
function inRefundGrace(b: Pick<Booking, 'refundGraceUntil'>, now?: Date): boolean {
  return !!b.refundGraceUntil && marinaNow(now).date <= b.refundGraceUntil;
}

/** The refund an earlier try at cancelling this booking got through Stripe. */
async function findCancelRefund(
  stripe: Pick<Stripe, 'refunds'>,
  paymentIntentId: string,
  bookingId: string,
): Promise<Stripe.Refund | null> {
  const { data } = await stripe.refunds.list({
    payment_intent: paymentIntentId,
    limit: 100,
    expand: ['data.charge'],
  });
  return (
    data.find(
      (r) => r.metadata?.bookingId === bookingId && r.metadata?.cancelledBy === 'customer',
    ) ?? null
  );
}

const PAYMENT_WENT_THROUGH =
  'Your payment just went through, so this booking is paid for now. ' +
  'Reload the page to see what you\'d get back, then cancel from there.';

function alreadyCancelled(booking: Booking) {
  return {
    alreadyCancelled: true,
    booking: {
      id: booking.id,
      status: booking.status,
      amountRefundedCents: booking.amountRefundedCents,
    },
  };
}

/**
 * Cancels a booking the customer hasn't paid for. Its Stripe Checkout
 * session may still be open in another tab, so this goes through
 * releaseHold: the session is expired first, and the booking cancelled only
 * once Stripe says it can't be paid. Otherwise the customer could still pay
 * and stripeWebhook would find a paid booking that's been cancelled.
 *
 * If the payment beat us to it, nothing is cancelled. Their refund depends on
 * the policy, so they reload and see it before cancelling.
 */
export async function cancelUnpaidBooking(
  hold: CheckoutHold,
  reason: string | undefined,
  deps: {
    stripe: Pick<Stripe, 'checkout'>;
    db?: Firestore;
  },
): Promise<{
  outcome: ReleaseOutcome;
  status: number;
  body: Record<string, unknown>;
}> {
  const outcome = await releaseHold(hold, deps, {
    reason: reason ?? 'Cancelled before paying',
  });
  switch (outcome) {
    case 'released':
      return {
        outcome,
        status: 200,
        body: { ok: true, unpaid: true, refundCents: 0, refundPercent: 0, stripeRefundId: null },
      };
    case 'checkout-complete':
      return { outcome, status: 409, body: { error: PAYMENT_WENT_THROUGH } };
    case 'no-session':
      return {
        outcome,
        status: 409,
        body: { error: 'Your checkout is still being set up. Try again in a minute.' },
      };
    case 'not-found':
      return { outcome, status: 404, body: { error: 'Booking not found' } };
    case 'not-held': {
      // It changed after we looked: cancelled by the expiry webhook, or paid.
      const fresh = (
        await (deps.db ?? db).collection('bookings').doc(hold.bookingId).get()
      ).data() as Booking | undefined;
      if (fresh?.status === 'cancelled') {
        return { outcome, status: 200, body: alreadyCancelled(fresh) };
      }
      return { outcome, status: 409, body: { error: PAYMENT_WENT_THROUGH } };
    }
  }
}

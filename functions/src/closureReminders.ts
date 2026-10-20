import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import type { Firestore } from 'firebase-admin/firestore';

import { db as defaultDb } from './lib/firebase';
import { RESEND_API_KEY, RESEND_FROM_EMAIL } from './lib/resend';
import { isEmailSendError, sendEmail } from './lib/email-log';
import { APP_BASE_URL, ADMIN_EMAIL } from './lib/config';
import { awaitingMove } from './lib/closure';
import { MARINA, PHONE_DISPLAY, markClosureField } from './lib/close-day';
import { addDays, marinaNow, zonedTimeToUtc } from './lib/datetime';
import { buildClosureOfferEmail } from './lib/email-templates';
import type { CancellationMailer } from './lib/admin-cancel';
import { customerMailer } from './lib/customer-mailer';
import { resendDeadlineEmails } from './settleClosedBookings';
import type { Booking, ClosureAction } from './lib/types';

/**
 * settleClosedBookings runs at this time (marina time) on the day after
 * `closure.decideBy`, and refunds whoever still hasn't chosen.
 */
const SETTLE_TIME = '06:00';
/** The reminder goes this long before that. */
export const CLOSURE_REMINDER_LEAD_MS = 24 * 60 * 60 * 1000;

/** When settleClosedBookings refunds a booking that's still waiting on `decideBy`. */
export function settlesAt(decideBy: string): Date {
  return zonedTimeToUtc(addDays(decideBy, 1), SETTLE_TIME);
}

/**
 * Whether this booking gets its one reminder now: it's still waiting on
 * the customer's choice, it hasn't had one for this closure, there's
 * somewhere to send it, and the refund is less than a day off but hasn't
 * happened yet.
 */
export function closureReminderDue(b: Booking, now: Date): boolean {
  if (!awaitingMove(b) || !b.closure) return false;
  if (b.closure.reminderSentAt) return false;
  if (!b.customerEmail) return false;
  const settle = settlesAt(b.closure.decideBy).getTime();
  return now.getTime() >= settle - CLOSURE_REMINDER_LEAD_MS && now.getTime() < settle;
}

export interface ClosureReminderDeps {
  db?: Firestore;
  now?: Date;
  baseUrl: string;
  send: (msg: { to: string; subject: string; html: string; text: string; bookingId: string; idempotencyKey: string }) => Promise<void>;
}

/**
 * One reminder to each customer who was asked to pick a new date or take
 * a refund and hasn't, sent once, the day before they're refunded. One
 * failure doesn't stop the rest; the next hourly run tries it again. That
 * includes a closure a reopen under the previous version left behind
 * (isStaleClosure in lib/close-day.ts): they're still choosing, and are
 * refunded at the deadline like the rest.
 */
export async function sendClosureReminders(deps: ClosureReminderDeps): Promise<{ sent: string[]; failed: string[] }> {
  const db = deps.db ?? defaultDb;
  const now = deps.now ?? new Date();
  // Today's and tomorrow's deadlines (marina time) cover the window.
  const from = addDays(now.toISOString().slice(0, 10), -2);
  const snap = await db.collection('bookings').where('closure.decideBy', '>=', from).get();
  const due = snap.docs
    .map((d) => ({ ...(d.data() as Booking), id: d.id }))
    .filter((b) => closureReminderDue(b, now));

  const result = { sent: [] as string[], failed: [] as string[] };
  for (const booking of due) {
    const closure = booking.closure!;
    try {
      const { subject, html, text } = buildClosureOfferEmail({
        booking,
        reason: closure.reason,
        decideBy: closure.decideBy,
        baseUrl: deps.baseUrl,
        phoneDisplay: PHONE_DISPLAY,
        marina: MARINA,
        reminder: true,
      });
      await deps.send({
        to: booking.customerEmail,
        subject,
        html,
        text,
        bookingId: booking.id,
        idempotencyKey: `closure-reminder/${booking.id}/${closure.blackoutId}`,
      });
      await markClosureField(db, booking.id, closure.blackoutId, 'reminderSentAt', now);
      result.sent.push(booking.id);
    } catch (err) {
      logger.error('Closure reminder failed', { bookingId: booking.id, err });
      result.failed.push(booking.id);
    }
  }
  return result;
}

/**
 * The "pick a new date or take a full refund" email to each customer a
 * closure offered it to whose email didn't go when it went out (Resend
 * refused it, with nobody watching): no `closure.offerEmailedAt`. Not while
 * that closure is still going out (its own run sends it), nor once the
 * time to choose is over. Sent under the closure's own key, so one whose
 * first try went through after all doesn't go twice. If its reminder is
 * due by now, this is their reminder too.
 */
export async function resendClosureOffers(deps: {
  db?: Firestore;
  now?: Date;
  baseUrl: string;
  mailer: CancellationMailer;
}): Promise<{ sent: string[]; failed: string[] }> {
  const db = deps.db ?? defaultDb;
  const now = deps.now ?? new Date();
  const today = marinaNow(now).date;
  const snap = await db.collection('bookings').where('closure.decideBy', '>=', today).get();
  const unsent = snap.docs
    .map((d) => ({ ...(d.data() as Booking), id: d.id }))
    .filter((b) => awaitingMove(b) && !!b.closure && !b.closure.offerEmailedAt && !!b.customerEmail);

  const result = { sent: [] as string[], failed: [] as string[] };
  const going = new Map<string, boolean>();
  for (const booking of unsent) {
    const closure = booking.closure!;
    try {
      if (!going.has(closure.blackoutId)) {
        const action = (await db.collection('closureActions').doc(closure.blackoutId).get()).data() as ClosureAction | undefined;
        going.set(closure.blackoutId, action?.state === 'pending' || action?.state === 'finalizing');
      }
      if (going.get(closure.blackoutId)) continue;
      const remind = closureReminderDue(booking, now);
      const { subject, html, text } = buildClosureOfferEmail({
        booking,
        reason: closure.reason,
        decideBy: closure.decideBy,
        baseUrl: deps.baseUrl,
        phoneDisplay: PHONE_DISPLAY,
        marina: MARINA,
      });
      await deps.mailer.send({
        to: booking.customerEmail,
        subject,
        html,
        text,
        bookingId: booking.id,
        kind: 'closureOffer',
        idempotencyKey: `closure-offer/${booking.id}/${closure.blackoutId}`,
      });
      await markClosureField(db, booking.id, closure.blackoutId, 'offerEmailedAt', now);
      if (remind) await markClosureField(db, booking.id, closure.blackoutId, 'reminderSentAt', now);
      result.sent.push(booking.id);
    } catch (err) {
      logger.error('Resending a closure offer failed', { bookingId: booking.id, err });
      result.failed.push(booking.id);
    }
  }
  return result;
}

/** Every hour, marina time. */
export const sendClosureRemindersHourly = onSchedule(
  {
    schedule: '0 * * * *',
    timeZone: 'America/New_York',
    region: 'us-central1',
    secrets: [RESEND_API_KEY, RESEND_FROM_EMAIL, APP_BASE_URL],
    retryCount: 0,
  },
  async () => {
    // Closure emails that didn't go when nobody was watching: the offers
    // first, so one sent this late doubles as the reminder below.
    const mailer = customerMailer();
    const offers = await resendClosureOffers({ baseUrl: APP_BASE_URL.value(), mailer });
    if (offers.sent.length || offers.failed.length) logger.info('Closure offers sent again', offers);
    const cancellations = await resendDeadlineEmails({ mailer });
    if (cancellations.length) logger.info('Sent closure cancellation emails an earlier run couldn’t', { cancellations });

    const replyTo = ADMIN_EMAIL.value();
    const result = await sendClosureReminders({
      baseUrl: APP_BASE_URL.value(),
      async send({ to, subject, html, text, bookingId, idempotencyKey }) {
        try {
          // Logged as a closure reminder, so a bounce is flagged on the booking.
          await sendEmail({
            kind: 'closureReminder',
            bookingId,
            to,
            subject,
            html,
            text,
            replyTo,
            headers: { 'X-Entity-Ref-ID': bookingId, 'X-Email-Type': 'closure-reminder' },
            idempotencyKey,
          });
        } catch (err) {
          // Sent already; only the marker failed last time.
          if (isEmailSendError(err, 'invalid_idempotent_request')) return;
          throw err;
        }
      },
    });
    if (result.sent.length || result.failed.length) logger.info('Closure reminders', result);
  },
);

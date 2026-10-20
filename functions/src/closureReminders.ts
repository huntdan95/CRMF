import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import type { Firestore } from 'firebase-admin/firestore';

import { db as defaultDb } from './lib/firebase';
import { RESEND_API_KEY, RESEND_FROM_EMAIL } from './lib/resend';
import { isEmailSendError, sendEmail } from './lib/email-log';
import { APP_BASE_URL, ADMIN_EMAIL } from './lib/config';
import { awaitingMove } from './lib/closure';
import { MARINA, PHONE_DISPLAY, isStaleClosure, markClosureField } from './lib/close-day';
import { addDays, zonedTimeToUtc } from './lib/datetime';
import { buildClosureOfferEmail } from './lib/email-templates';
import type { Booking } from './lib/types';

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
 * failure doesn't stop the rest; the next hourly run tries it again. Not
 * for a closure a reopen left behind (isStaleClosure): the day is open
 * again and nobody is refunded.
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
      if (await isStaleClosure(db, booking)) continue;
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

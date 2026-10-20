import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import type { Firestore } from 'firebase-admin/firestore';

import { db as defaultDb, FieldValue } from './lib/firebase';
import { RESEND_API_KEY, RESEND_FROM_EMAIL } from './lib/resend';
import { isEmailSendError, sendEmail } from './lib/email-log';
import { APP_BASE_URL, ADMIN_EMAIL, SEND_TOUR_REMINDERS } from './lib/config';
import { buildTourReminderEmail } from './lib/email-templates';
import { fetchDayForecast, type DayForecast } from './lib/forecast';
import { addDays, marinaNow } from './lib/datetime';
import { isGoingAhead, type Booking } from './lib/types';

const MARINA = {
  name: "Pete's Pier Marina",
  address: '1 SW First Place, Crystal River, FL 34429',
  // Same as siteConfig.marina.mapUrl.
  mapUrl: 'https://maps.google.com/?q=Pete%27s+Pier+Marina+Crystal+River+FL',
};
const PHONE_DISPLAY = '352-586-7792';

/** Tomorrow's reminder for one booking, as the daily job sends it. */
export function reminderEmailFor(booking: Booking, baseUrl: string, forecast: DayForecast | null) {
  return buildTourReminderEmail({
    booking,
    baseUrl,
    marina: MARINA,
    phoneDisplay: PHONE_DISPLAY,
    forecast,
  });
}

/** Booked this recently, the confirmation email is reminder enough. */
const JUST_BOOKED_MS = 12 * 60 * 60 * 1000;

type Candidate = Booking & { reminderSentFor?: string };

/** The departure a reminder covers. A booking moved to another day gets a new one. */
function reminderKey(b: Pick<Booking, 'date' | 'timeSlot'>): string {
  return `${b.date}/${b.timeSlot}`;
}

function millis(ts: unknown): number | null {
  if (ts && typeof ts === 'object' && typeof (ts as { toMillis?: () => number }).toMillis === 'function') {
    return (ts as { toMillis: () => number }).toMillis();
  }
  return null;
}

/** Whether this booking should get tomorrow's reminder now. */
export function reminderDue(b: Candidate, nowMs: number): boolean {
  if (!isGoingAhead(b)) return false;
  // Travis closed the departure; they've been asked to pick another.
  if (b.closure) return false;
  if (!b.customerEmail) return false;
  if (b.reminderSentFor === reminderKey(b)) return false;
  const created = millis(b.createdAt);
  return created === null || nowMs - created >= JUST_BOOKED_MS;
}

export interface ReminderDeps {
  db?: Firestore;
  now?: Date;
  baseUrl: string;
  forecast: (date: string) => Promise<DayForecast | null>;
  send: (msg: {
    to: string;
    subject: string;
    html: string;
    text: string;
    bookingId: string;
    idempotencyKey: string;
  }) => Promise<{ id: string | null }>;
}

/**
 * Emails everyone going out tomorrow (marina time) who hasn't had a reminder
 * for that departure. One failure doesn't stop the rest; the next run tries
 * it again.
 */
export async function sendTourReminders(deps: ReminderDeps): Promise<{ sent: string[]; failed: string[] }> {
  const db = deps.db ?? defaultDb;
  const now = deps.now ?? new Date();
  const tomorrow = addDays(marinaNow(now).date, 1);

  const snap = await db.collection('bookings').where('date', '==', tomorrow).get();
  const due = snap.docs
    .map((d) => ({ ...(d.data() as Candidate), id: d.id }))
    .filter((b) => reminderDue(b, now.getTime()));

  const result = { sent: [] as string[], failed: [] as string[] };
  if (due.length === 0) return result;

  const forecast = await deps.forecast(tomorrow);
  for (const booking of due) {
    try {
      const { subject, html, text } = reminderEmailFor(booking, deps.baseUrl, forecast);
      const key = reminderKey(booking);
      const { id } = await deps.send({
        to: booking.customerEmail,
        subject,
        html,
        text,
        bookingId: booking.id,
        idempotencyKey: `tour-reminder/${booking.id}/${key}`,
      });
      await db.collection('bookings').doc(booking.id).update({
        reminderSentFor: key,
        reminderSentAt: FieldValue.serverTimestamp(),
        reminderMessageId: id,
      });
      result.sent.push(booking.id);
    } catch (err) {
      logger.error('Tour reminder failed', { bookingId: booking.id, err });
      result.failed.push(booking.id);
    }
  }
  return result;
}

/**
 * 9:00 AM the day before, and again at 5:00 PM to retry anything that
 * failed. Not copied to Travis: he has the day's list in admin.
 */
export const sendTourRemindersDaily = onSchedule(
  {
    schedule: '0 9,17 * * *',
    timeZone: 'America/New_York',
    region: 'us-central1',
    secrets: [RESEND_API_KEY, RESEND_FROM_EMAIL, APP_BASE_URL],
    retryCount: 0,
  },
  async () => {
    if (!SEND_TOUR_REMINDERS.value()) {
      logger.info('Tour reminders are off (SEND_TOUR_REMINDERS)');
      return;
    }
    const replyTo = ADMIN_EMAIL.value();
    const result = await sendTourReminders({
      baseUrl: APP_BASE_URL.value(),
      forecast: (date) => fetchDayForecast(date),
      async send({ to, subject, html, text, bookingId, idempotencyKey }) {
        try {
          return await sendEmail({
            kind: 'reminder',
            bookingId,
            to,
            subject,
            html,
            text,
            replyTo,
            headers: { 'X-Entity-Ref-ID': bookingId, 'X-Email-Type': 'tour-reminder' },
            idempotencyKey,
          });
        } catch (err) {
          // The key was used with a different email (a fresh forecast at the
          // 5 PM run, say): this departure's reminder already went out, and
          // only the marker afterwards failed.
          if (isEmailSendError(err, 'invalid_idempotent_request')) return { id: null };
          throw err;
        }
      },
    });
    logger.info('Tour reminders', result);
  },
);

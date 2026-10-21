import { onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import { z } from 'zod';

import { db, FieldValue, Timestamp } from './lib/firebase';
import { RESEND_API_KEY, RESEND_FROM_EMAIL } from './lib/resend';
import { APP_BASE_URL } from './lib/config';
import { addDays, marinaNow, zonedTimeToUtc } from './lib/datetime';
import { getsAutomatedEmail, isMessageable, notifyOwner, onOpenDepartures } from './lib/notify';
import { SLOT_MINUTES, slotStartMinutes } from './lib/schedule';
import { buildReviewListEmail } from './lib/owner-templates';
import {
  applyCors,
  badRequest,
  methodNotAllowed,
  serverError,
} from './lib/http';
import { requireAdmin, writeAudit, AdminAuthError } from './lib/admin-auth';
import { sendReviewRequest, type ReviewRequestState } from './postTourFollowup';
import { retryFeedbackEmails } from './feedback';
import type { Booking } from './lib/types';

/*
 * Same-evening review requests, with Travis's list.
 *
 * Policy (don't change without asking the owner): every guest whose trip
 * actually ran gets the same request. Travis can take out only trips that
 * didn't run ("Didn't sail" marks the booking a no-show). For a trip that
 * went badly he can hold the request to call first, for up to 3 days, but
 * not cancel it. Asking only happy guests is review gating, which Google
 * prohibits.
 *
 *   6:00 PM  sendReviewList          Travis gets "[CRMF] 3 review requests go out at 7:00"
 *                                    (6:30 tries again if the email failed)
 *   7:00 PM  sendReviewRequests      today's trips that are back, minus held and excluded
 *   hourly   sendHeldReviewRequests  holds that have run out, and any missed (a sunset
 *                                    cruise still out at 7:00 goes the next morning)
 *
 * Marker: `postTourFollowupSentAt`. A hold is `reviewHoldUntil`.
 */

type Row = Booking & ReviewRequestState;

/** When a hold set on a trip runs out: 7:00 PM ET, 3 days after the trip. */
export function holdUntil(tripDate: string): Date {
  return zonedTimeToUtc(addDays(tripDate, 3), '19:00');
}

function isHeld(b: Row, now: Date): boolean {
  return !!b.reviewHoldUntil && b.reviewHoldUntil.toMillis() > now.getTime();
}

/**
 * Today's bookings that will get (or have had) a request: the trip ran
 * (not on a departure Travis closed), not refunded, and they haven't
 * marked our email as spam.
 */
async function todaysRequests(date: string): Promise<Row[]> {
  const snap = await db.collection('bookings').where('date', '==', date).get();
  return onOpenDepartures(
    snap.docs.map((d) => ({ ...(d.data() as Row), id: d.id })).filter((b) => getsAutomatedEmail(b) && !b.marketingSuppressed),
  );
}

/** When the evening run goes, in marina minutes. */
const REQUESTS_AT = 19 * 60;

/**
 * Back in by 7:00 PM, so tonight's run sends theirs. A sunset cruise often
 * isn't: theirs goes with the next morning's missed ones (sendReviewRequest
 * waits until the boat is back).
 */
function backByRequestTime(b: Row): boolean {
  return slotStartMinutes(b.timeSlot, b.date) + SLOT_MINUTES[b.timeSlot] <= REQUESTS_AT;
}

const SCHEDULE_OPTS = {
  timeZone: 'America/New_York',
  region: 'us-central1',
  secrets: [RESEND_API_KEY, RESEND_FROM_EMAIL, APP_BASE_URL],
  retryCount: 0,
};

/* -------------------------------------------------------------------------- */
/* 6:00 PM — Travis's list                                                    */
/* -------------------------------------------------------------------------- */

export const sendReviewList = onSchedule({ ...SCHEDULE_OPTS, schedule: '0,30 18 * * *' }, async () => {
  await runReviewList(new Date());
});

/**
 * Emails Travis the list once per day (`reviewLists/{date}.sentAt`; each
 * listed booking gets `reviewListSentAt`). Nothing when no request is due.
 *
 * If the email fails, the day's doc is still written, without `sentAt`:
 * its push (notifyAdminOfReviewList) still gives Travis his hour to hold a
 * request or mark a trip that didn't sail, and the 6:30 run sends the
 * email again. Throws then, so the failure is logged.
 */
export async function runReviewList(now: Date): Promise<string> {
  const date = marinaNow(now).date;
  const runRef = db.collection('reviewLists').doc(date);
  if ((await runRef.get()).get('sentAt')) return 'already-sent';

  const today = (await todaysRequests(date)).filter((b) => !b.postTourFollowupSentAt);
  const going = today.filter((b) => !isHeld(b, now) && backByRequestTime(b));
  const tomorrow = today.filter((b) => !isHeld(b, now) && !backByRequestTime(b));
  const held = today.filter((b) => isHeld(b, now));
  if (going.length === 0 && tomorrow.length === 0) {
    logger.info('No review requests due tonight; no list sent', { date });
    return 'none-due';
  }

  const email = buildReviewListEmail({ date, going, tomorrow, held, baseUrl: APP_BASE_URL.value() });
  let emailed = true;
  let emailError: unknown;
  try {
    await notifyOwner({ type: 'review-list', key: `review-list/${date}`, ...email });
  } catch (err) {
    emailed = false;
    emailError = err;
  }

  const batch = db.batch();
  batch.set(runRef, {
    date,
    ...(emailed ? { sentAt: FieldValue.serverTimestamp() } : { emailFailedAt: FieldValue.serverTimestamp() }),
    going: going.length,
    tomorrow: tomorrow.length,
    held: held.length,
  });
  for (const b of [...going, ...tomorrow]) {
    batch.update(db.collection('bookings').doc(b.id), { reviewListSentAt: FieldValue.serverTimestamp() });
  }
  await batch.commit();
  if (!emailed) throw emailError;
  return 'sent';
}

/* -------------------------------------------------------------------------- */
/* 7:00 PM — the requests                                                     */
/* -------------------------------------------------------------------------- */

export const sendReviewRequests = onSchedule({ ...SCHEDULE_OPTS, schedule: 'every day 19:00' }, async () => {
  await runReviewRequests(new Date());
});

export async function runReviewRequests(now: Date) {
  const date = marinaNow(now).date;
  const due = (await todaysRequests(date)).filter((b) => !b.postTourFollowupSentAt && !isHeld(b, now));
  return sendEach('7 PM review requests', due, now);
}

async function sendEach(job: string, bookings: Row[], now: Date) {
  const counts = { sent: 0, skipped: 0, failed: 0 };
  for (const b of bookings) {
    try {
      // A Hold tapped since this run read the list still holds it.
      const r = await sendReviewRequest(b.id, { now, respectHold: true });
      if (r.sent) counts.sent++;
      else counts.skipped++;
    } catch (err) {
      counts.failed++;
      logger.error(`${job}: failed for booking`, { bookingId: b.id, err });
    }
  }
  logger.info(job, { candidates: bookings.length, ...counts });
  return counts;
}

/* -------------------------------------------------------------------------- */
/* Hourly — holds that ran out, and anything missed                           */
/* -------------------------------------------------------------------------- */

/** Missed sends are retried for trips this many days back... */
const MISSED_LOOKBACK_DAYS = 3;
/** ...between these marina hours, so nobody gets one at 3 AM. */
const DAYTIME = { from: 9 * 60, to: 20 * 60 };

export const sendHeldReviewRequests = onSchedule(
  { ...SCHEDULE_OPTS, schedule: 'every 60 minutes' },
  async () => {
    await runHeldReviewRequests(new Date());
  },
);

export async function runHeldReviewRequests(now: Date) {
  const clock = marinaNow(now);
  const expired = await db
    .collection('bookings')
    .where('reviewHoldUntil', '<=', Timestamp.fromDate(now))
    .get();
  const due: Row[] = expired.docs
    .map((d) => ({ ...(d.data() as Row), id: d.id }))
    .filter((b) => !b.postTourFollowupSentAt);

  // A 7:00 PM run that failed, or a trip from before this schedule existed.
  if (clock.minutes >= DAYTIME.from && clock.minutes < DAYTIME.to) {
    const recent = await db
      .collection('bookings')
      .where('date', '>=', addDays(clock.date, -MISSED_LOOKBACK_DAYS))
      .where('date', '<', clock.date)
      .get();
    for (const d of recent.docs) {
      const b = { ...(d.data() as Row), id: d.id };
      if (!b.postTourFollowupSentAt && !b.reviewHoldUntil && getsAutomatedEmail(b) && !b.marketingSuppressed && !due.some((x) => x.id === b.id)) {
        due.push(b);
      }
    }
  }

  // Not a trip Travis closed: sendReviewRequest would only skip it, every hour.
  const counts = await sendEach('Held/missed review requests', await onOpenDepartures(due), now);
  await retryFeedbackEmails(now).catch((err) => logger.error('Feedback email retry failed', { err }));
  return counts;
}

/* -------------------------------------------------------------------------- */
/* Admin: Send now / Hold                                                     */
/* -------------------------------------------------------------------------- */

/**
 * POST /adminReviewRequest { bookingId, action: 'send' | 'hold' }
 *
 * From Admin → Review requests. "Didn't sail" isn't here: the page marks
 * the booking a no-show with adminMarkBooking, and no-shows never get a
 * request. There is deliberately no way to cancel a request.
 */
export const adminReviewRequest = onRequest(
  {
    cors: false,
    secrets: [RESEND_API_KEY, RESEND_FROM_EMAIL, APP_BASE_URL],
    maxInstances: 5,
  },
  async (req, res) => {
    if (applyCors(req, res)) return;
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    try {
      const admin = await requireAdmin(req);
      const parsed = z
        .object({
          bookingId: z.string().min(1).max(64),
          action: z.enum(['send', 'hold']),
        })
        .safeParse(req.body);
      if (!parsed.success) return badRequest(res, 'Invalid input', parsed.error.format());
      const { bookingId, action } = parsed.data;

      const ref = db.collection('bookings').doc(bookingId);
      const snap = await ref.get();
      const booking = snap.exists ? { ...(snap.data() as Row), id: snap.id } : undefined;
      if (!booking) {
        res.status(404).json({ error: 'Booking not found' });
        return;
      }
      if (booking.postTourFollowupSentAt) {
        res.status(409).json({ error: 'Their review request has already gone out.' });
        return;
      }

      if (action === 'hold') {
        if (!isMessageable(booking)) {
          res.status(409).json({ error: 'This booking doesn’t get a review request.' });
          return;
        }
        const until = holdUntil(booking.date);
        if (until.getTime() <= Date.now()) {
          res.status(409).json({ error: 'That trip was more than 3 days ago, so it can’t be held.' });
          return;
        }
        await ref.update({
          reviewHoldUntil: Timestamp.fromDate(until),
          reviewHeldAt: FieldValue.serverTimestamp(),
          reviewHeldBy: admin.email,
          updatedAt: FieldValue.serverTimestamp(),
        });
        await writeAudit({
          admin,
          action: 'review.hold',
          targetId: bookingId,
          payload: { until: until.toISOString(), before: booking.reviewHoldUntil?.toDate().toISOString() ?? null },
        });
        res.status(200).json({ ok: true, holdUntil: until.toISOString() });
        return;
      }

      const result = await sendReviewRequest(bookingId);
      await writeAudit({ admin, action: 'review.send', targetId: bookingId, payload: { ...result } });
      if (!result.sent) {
        const why: Record<string, string> = {
          'not-yet': 'Their boat isn’t back yet. It can go once the trip is over.',
          'too-old': 'That trip was too long ago.',
          'not-confirmed': 'This booking doesn’t get a review request (cancelled, no-show, or refunded).',
          closed: 'You closed this trip, so it doesn’t get a review request.',
          suppressed: 'They marked one of our emails as spam, so the request skips them. You can still send it from their booking page.',
          'already-sent': 'Their review request has already gone out.',
          'not-found': 'Booking not found.',
        };
        res.status(409).json({ error: why[result.skipped ?? ''] ?? 'Not sent.', skipped: result.skipped });
        return;
      }
      res.status(200).json({ ok: true, sent: true });
    } catch (err) {
      if (err instanceof AdminAuthError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      serverError(res, err);
    }
  },
);

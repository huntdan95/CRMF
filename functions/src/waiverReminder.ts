import { onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import type { Firestore } from 'firebase-admin/firestore';
import { z } from 'zod';

import { db as defaultDb, FieldValue, Timestamp } from './lib/firebase';
import { RESEND_API_KEY, RESEND_FROM_EMAIL } from './lib/resend';
import { sendEmail } from './lib/email-log';
import { APP_BASE_URL, ADMIN_EMAIL } from './lib/config';
import { SITE_TIMEZONE } from './lib/datetime';
import { buildWaiverReminderEmail } from './lib/email-templates';
import { SEND_TOUR_REMINDERS } from './tourReminders';
import { closedDeparturesOn } from './lib/close-day';
import {
  applyCors,
  badRequest,
  methodNotAllowed,
  serverError,
} from './lib/http';
import {
  requireAdmin,
  writeAudit,
  AdminAuthError,
} from './lib/admin-auth';
import { ADULT_AGE, waiverCoverage, type WaiverForCoverage } from './lib/waiver-coverage';
import { isGoingAhead, type Booking } from './lib/types';

const MARINA = {
  name: "Pete's Pier Marina",
  address: '1 SW First Place, Crystal River, FL 34429',
};
const PHONE_DISPLAY = '352-586-7792';

/** How long a send in flight holds the booking; older claims are from a crash. */
const CLAIM_TTL_MS = 10 * 60 * 1000;

interface ReminderMarker {
  waiverReminderSentAt?: Timestamp | null;
  /**
   * `date/timeSlot` the last reminder went out for, so a booking moved to
   * another departure gets one for that one too.
   */
  waiverReminderSentFor?: string | null;
  waiverReminderClaimedAt?: Timestamp | null;
  waiverReminderMessageId?: string | null;
}

type ReminderBooking = Booking & ReminderMarker;

/** The departure a reminder covers, as the tour reminder keys it. */
function reminderKey(b: Pick<Booking, 'date' | 'timeSlot'>): string {
  return `${b.date}/${b.timeSlot}`;
}

/** Whether the booking has had its reminder for the departure it's on now. */
function remindedForDeparture(b: Pick<Booking, 'date' | 'timeSlot'> & ReminderMarker): boolean {
  if (b.waiverReminderSentFor) return b.waiverReminderSentFor === reminderKey(b);
  // Sent before the departure was recorded. Which one it was for isn't
  // known, so it counts for this one rather than risk a second email.
  return !!b.waiverReminderSentAt;
}

/** `YYYY-MM-DD` in the marina's timezone, `offsetDays` after `now`. */
export function marinaDate(now: Date, offsetDays = 0): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: SITE_TIMEZONE,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return new Date(Date.UTC(get('year'), get('month') - 1, get('day') + offsetDays))
    .toISOString()
    .slice(0, 10);
}

/** A booking's signed waivers, oldest first (coverage keeps the earliest). */
async function waiversFor(db: Firestore, bookingId: string): Promise<WaiverForCoverage[]> {
  const snap = await db.collection('waivers').where('bookingId', '==', bookingId).get();
  return snap.docs
    .map((d) => ({ ...(d.data() as WaiverForCoverage & { signedAt?: Timestamp }), id: d.id }))
    .sort((a, b) => (a.signedAt?.toMillis() ?? 0) - (b.signedAt?.toMillis() ?? 0));
}

export interface StillToSign {
  /** Roster guests with no signed waiver, in booking order. */
  unsigned: Array<{ name: string; minor: boolean }>;
  /** Guests beyond the named roster who still need to sign. */
  unnamedCount: number;
  signedCount: number;
  needed: number;
  /** Someone signed under a name that isn't on the booking. */
  hasUnmatched: boolean;
}

/**
 * Who on the booking still needs to sign, or null when everyone has.
 * "Everyone" is the same count the admin Waivers card shows. With no party
 * size on file (`needed` 0) that's never known, so they're always asked to
 * check that everyone has signed.
 */
export function stillToSign(
  booking: Pick<Booking, 'guests' | 'guestCount'>,
  waivers: WaiverForCoverage[],
): StillToSign | null {
  const coverage = waiverCoverage(booking.guests, booking.guestCount, waivers);
  if (coverage.complete) return null;
  const unsigned = coverage.roster
    .filter((r) => !r.covered)
    .map((r) => ({ name: r.name, minor: r.age != null && r.age < ADULT_AGE }));
  return {
    unsigned,
    unnamedCount: Math.max(0, coverage.needed - coverage.signedCount - unsigned.length),
    signedCount: coverage.signedCount,
    needed: coverage.needed,
    hasUnmatched: coverage.unmatched.length > 0 && unsigned.length > 0,
  };
}

/**
 * Bookings on `tripDate` the scheduled run should remind: going ahead
 * (confirmed, or an old-site reservation), not reminded for this departure
 * yet, not on a departure Travis closed (they're choosing a new date or a
 * refund) or is closing right now, and someone in the party still to sign.
 */
export async function findWaiverReminderCandidates(
  tripDate: string,
  db: Firestore = defaultDb,
): Promise<string[]> {
  const [snap, closed] = await Promise.all([
    db.collection('bookings').where('date', '==', tripDate).get(),
    closedDeparturesOn(db, tripDate),
  ]);
  const due: string[] = [];
  for (const doc of snap.docs) {
    const booking = { ...(doc.data() as ReminderBooking), id: doc.id };
    if (!isGoingAhead(booking) || booking.closure || remindedForDeparture(booking)) continue;
    // A blackout covers it, as the tour reminder checks. Nothing is marked,
    // but this is the only run for that day: if he reopens the departure
    // after it, no reminder goes unless he sends one from the booking.
    if (closed(booking.timeSlot)) continue;
    if (stillToSign(booking, await waiversFor(db, doc.id))) due.push(doc.id);
  }
  return due;
}

export type ReminderSkip =
  | 'not-found'
  | 'not-confirmed'
  | 'closed'
  | 'past'
  | 'already-sent'
  | 'in-progress'
  | 'all-signed';

export interface ReminderResult {
  sent: boolean;
  skipped?: ReminderSkip;
}

/** Delivers one reminder and returns the provider's message id. */
export type ReminderMailer = (msg: {
  bookingId: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  idempotencyKey?: string;
}) => Promise<string | null>;

/**
 * Through sendEmail, so it's logged and a bounce is flagged on the booking
 * and alerts Travis like the other emails before a trip.
 */
const resendMailer: ReminderMailer = async ({ bookingId, to, subject, html, text, idempotencyKey }) => {
  const { id } = await sendEmail({
    kind: 'waiverReminder',
    bookingId,
    to,
    subject,
    html,
    text,
    replyTo: ADMIN_EMAIL.value(),
    headers: {
      'X-Entity-Ref-ID': bookingId,
      'X-Email-Type': 'waiver-reminder',
    },
    idempotencyKey,
  });
  return id;
};

/**
 * Emails the booker who in their party still needs to sign, with the
 * signing link. Without `force` a booking is reminded at most once per
 * departure (`waiverReminderSentFor`), and not while a blackout covers the
 * departure. With it (Travis's admin button, "Fix email and resend") it
 * sends again on purpose, and on a day he closed but left booked: he's
 * chosen to. Either way a claim on the booking stops the scheduled run and
 * an admin click from both sending at the same moment. `idempotencyKey`
 * goes to Resend, so a retry of the same resend doesn't send twice.
 */
export async function sendWaiverReminder(
  bookingId: string,
  opts: { force?: boolean; now?: Date; mail?: ReminderMailer; db?: Firestore; idempotencyKey?: string } = {},
): Promise<ReminderResult> {
  const { force = false, now = new Date(), mail = resendMailer, db = defaultDb, idempotencyKey } = opts;
  const ref = db.collection('bookings').doc(bookingId);

  const claimed = await db.runTransaction(
    async (tx): Promise<ReminderBooking | ReminderSkip> => {
      const snap = await tx.get(ref);
      if (!snap.exists) return 'not-found';
      const booking = { ...(snap.data() as ReminderBooking), id: snap.id };
      if (!isGoingAhead(booking)) return 'not-confirmed';
      if (booking.closure) return 'closed';
      if (booking.date < marinaDate(now)) return 'past';
      if (!force && remindedForDeparture(booking)) return 'already-sent';
      const claimedAt = booking.waiverReminderClaimedAt?.toMillis();
      if (claimedAt && now.getTime() - claimedAt < CLAIM_TTL_MS) return 'in-progress';
      tx.update(ref, { waiverReminderClaimedAt: Timestamp.fromDate(now) });
      return booking;
    },
  );
  if (typeof claimed === 'string') return { sent: false, skipped: claimed };
  const booking = claimed;

  let messageId: string | null;
  try {
    // The scheduled run picked this booking a moment ago; Travis may have
    // closed the departure since.
    if (!force && (await closedDeparturesOn(db, booking.date))(booking.timeSlot)) {
      await ref.update({ waiverReminderClaimedAt: FieldValue.delete() });
      return { sent: false, skipped: 'closed' };
    }
    const todo = stillToSign(booking, await waiversFor(db, bookingId));
    if (!todo) {
      await ref.update({ waiverReminderClaimedAt: FieldValue.delete() });
      return { sent: false, skipped: 'all-signed' };
    }
    const { subject, html, text } = buildWaiverReminderEmail({
      booking,
      baseUrl: APP_BASE_URL.value(),
      ...todo,
      tomorrow: booking.date === marinaDate(now, 1),
      phoneDisplay: PHONE_DISPLAY,
      marina: MARINA,
    });
    messageId = await mail({ bookingId, to: booking.customerEmail, subject, html, text, idempotencyKey });
  } catch (err) {
    // Nothing went out: release the claim so a retry can send.
    await ref.update({ waiverReminderClaimedAt: FieldValue.delete() }).catch(() => undefined);
    throw err;
  }

  // Sent. If this write fails the claim stays, so nothing re-sends for a while.
  await ref.update({
    waiverReminderSentAt: FieldValue.serverTimestamp(),
    waiverReminderSentFor: reminderKey(booking),
    waiverReminderMessageId: messageId,
    waiverReminderClaimedAt: FieldValue.delete(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return { sent: true };
}

/**
 * Scheduled daily at 15:00 ET. Emails the booker of each trip tomorrow
 * that's going ahead whose party hasn't finished signing waivers, once per
 * departure. Tolerates per-booking failures: they're logged and the rest
 * still go.
 */
export const sendWaiverReminders = onSchedule(
  {
    schedule: 'every day 15:00',
    timeZone: 'America/New_York',
    region: 'us-central1',
    secrets: [RESEND_API_KEY, RESEND_FROM_EMAIL, APP_BASE_URL],
    retryCount: 0,
  },
  async () => {
    // Off until launch with the tour reminders, for the same reason: until
    // the old site's bookings are re-synced, this could remind someone who
    // cancelled there, with a link to a site that isn't live yet.
    if (!SEND_TOUR_REMINDERS.value()) {
      logger.info('Waiver reminders are off (SEND_TOUR_REMINDERS)');
      return;
    }
    const tripDate = marinaDate(new Date(), 1);
    const due = await findWaiverReminderCandidates(tripDate);
    logger.info(`Waiver reminders for ${tripDate}`, { due: due.length });

    for (const bookingId of due) {
      try {
        const result = await sendWaiverReminder(bookingId);
        if (!result.sent) logger.info('Waiver reminder skipped', { bookingId, ...result });
      } catch (err) {
        logger.error('Waiver reminder failed for booking', { bookingId, err });
      }
    }
  },
);

/**
 * POST /adminSendWaiverReminder { bookingId }
 *
 * The "Send waiver reminder" button on the admin booking page. Sends even
 * if a reminder already went out (the page asks first), and before launch
 * too; skips when everyone has signed or the booking isn't an upcoming
 * trip that's going ahead.
 */
export const adminSendWaiverReminder = onRequest(
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
        .object({ bookingId: z.string().min(1).max(64) })
        .safeParse(req.body);
      if (!parsed.success) {
        return badRequest(res, 'Invalid input', parsed.error.format());
      }

      const result = await sendWaiverReminder(parsed.data.bookingId, { force: true });
      await writeAudit({
        admin,
        action: 'booking.update',
        targetId: parsed.data.bookingId,
        payload: { action: 'send-waiver-reminder', ...result },
      });
      res.status(200).json(result);
    } catch (err) {
      if (err instanceof AdminAuthError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      serverError(res, err);
    }
  },
);

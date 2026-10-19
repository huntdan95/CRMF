import { onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import { z } from 'zod';

import { db, FieldValue, Timestamp } from './lib/firebase';
import {
  RESEND_API_KEY,
  RESEND_FROM_EMAIL,
  getResend,
  getFromAddress,
} from './lib/resend';
import { APP_BASE_URL, ADMIN_EMAIL } from './lib/config';
import { SITE_TIMEZONE } from './lib/datetime';
import { buildWaiverReminderEmail } from './lib/email-templates';
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
import type { Booking } from './lib/types';

const MARINA = {
  name: "Pete's Pier Marina",
  address: '1 SW First Place, Crystal River, FL 34429',
};
const PHONE_DISPLAY = '352-586-7792';

/** How long a send in flight holds the booking; older claims are from a crash. */
const CLAIM_TTL_MS = 10 * 60 * 1000;

interface ReminderMarker {
  waiverReminderSentAt?: Timestamp | null;
  waiverReminderClaimedAt?: Timestamp | null;
  waiverReminderMessageId?: string | null;
}

type ReminderBooking = Booking & ReminderMarker;

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
async function waiversFor(bookingId: string): Promise<WaiverForCoverage[]> {
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
 * "Everyone" is the same count the admin Waivers card shows.
 */
export function stillToSign(
  booking: Pick<Booking, 'guests' | 'guestCount'>,
  waivers: WaiverForCoverage[],
): StillToSign | null {
  const coverage = waiverCoverage(booking.guests, booking.guestCount, waivers);
  if (coverage.signedCount >= coverage.needed) return null;
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
 * Bookings on `tripDate` the scheduled run should remind: confirmed, not
 * reminded before, and someone in the party still to sign.
 */
export async function findWaiverReminderCandidates(tripDate: string): Promise<string[]> {
  const snap = await db.collection('bookings').where('date', '==', tripDate).get();
  const due: string[] = [];
  for (const doc of snap.docs) {
    const booking = doc.data() as ReminderBooking;
    if (booking.status !== 'confirmed' || booking.waiverReminderSentAt) continue;
    if (stillToSign(booking, await waiversFor(doc.id))) due.push(doc.id);
  }
  return due;
}

export type ReminderSkip =
  | 'not-found'
  | 'not-confirmed'
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
}) => Promise<string | null>;

const resendMailer: ReminderMailer = async ({ bookingId, to, subject, html, text }) => {
  const { data, error } = await getResend().emails.send({
    from: getFromAddress(),
    to: [to],
    subject,
    html,
    text,
    replyTo: ADMIN_EMAIL.value(),
    headers: {
      'X-Entity-Ref-ID': bookingId,
      'X-Email-Type': 'waiver-reminder',
    },
  });
  if (error) {
    throw new Error(`Resend failed: ${error.message ?? 'unknown'}`);
  }
  return data?.id ?? null;
};

/**
 * Emails the booker who in their party still needs to sign, with the
 * signing link. Without `force` a booking is reminded at most once
 * (`waiverReminderSentAt`); Travis's admin button sends again on purpose.
 * Either way a claim on the booking stops the scheduled run and an admin
 * click from both sending at the same moment.
 */
export async function sendWaiverReminder(
  bookingId: string,
  opts: { force?: boolean; now?: Date; mail?: ReminderMailer } = {},
): Promise<ReminderResult> {
  const { force = false, now = new Date(), mail = resendMailer } = opts;
  const ref = db.collection('bookings').doc(bookingId);

  const claimed = await db.runTransaction(
    async (tx): Promise<ReminderBooking | ReminderSkip> => {
      const snap = await tx.get(ref);
      if (!snap.exists) return 'not-found';
      const booking = { ...(snap.data() as ReminderBooking), id: snap.id };
      if (booking.status !== 'confirmed') return 'not-confirmed';
      if (booking.date < marinaDate(now)) return 'past';
      if (!force && booking.waiverReminderSentAt) return 'already-sent';
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
    const todo = stillToSign(booking, await waiversFor(bookingId));
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
    messageId = await mail({ bookingId, to: booking.customerEmail, subject, html, text });
  } catch (err) {
    // Nothing went out: release the claim so a retry can send.
    await ref.update({ waiverReminderClaimedAt: FieldValue.delete() }).catch(() => undefined);
    throw err;
  }

  // Sent. If this write fails the claim stays, so nothing re-sends for a while.
  await ref.update({
    waiverReminderSentAt: FieldValue.serverTimestamp(),
    waiverReminderMessageId: messageId,
    waiverReminderClaimedAt: FieldValue.delete(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return { sent: true };
}

/**
 * Scheduled daily at 15:00 ET. Emails the booker of each confirmed trip
 * tomorrow whose party hasn't finished signing waivers, once per booking.
 * Tolerates per-booking failures: they're logged and the rest still go.
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
 * if a reminder already went out (the page asks first); skips when
 * everyone has signed or the booking isn't an upcoming confirmed trip.
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

import { onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import { z } from 'zod';

import { db, FieldValue } from './lib/firebase';
import { RESEND_API_KEY, RESEND_FROM_EMAIL } from './lib/resend';
import { sendEmail } from './lib/email-log';
import { APP_BASE_URL, ADMIN_EMAIL } from './lib/config';
import { buildPostTourFollowupEmail } from './lib/email-templates';
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
import type { Booking } from './lib/types';
import { marinaNow } from './lib/datetime';

// Social + review URLs — kept inline because the function workspace
// doesn't import from src/lib/site-config.ts. Update both when these
// change.
const INSTAGRAM_URL = 'https://www.instagram.com/capt.travisurbin/';
const FACEBOOK_URL = 'https://www.facebook.com/profile.php?id=61554023464570';
// TODO (owner): paste the real Google review URL once the GMB listing is
// claimed. Leave empty until then — the email template handles the absence.
const GOOGLE_REVIEW_URL = '';
const PHONE_DISPLAY = '352-586-7792';
// The email also invites a rebooking, so it carries the business's postal
// address (CAN-SPAM).
const MARINA = {
  name: "Pete's Pier Marina",
  address: '1 SW First Place, Crystal River, FL 34429',
};

/** Past this many days after the tour, a follow-up is no longer sent. */
const FOLLOWUP_MAX_AGE_DAYS = 14;

function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

interface SentMarker {
  postTourFollowupSentAt?: unknown;
  postTourFollowupMessageId?: string | null;
}

/**
 * Sends the follow-up to a single booking, idempotent on the
 * `postTourFollowupSentAt` marker. Used by both the scheduled job and
 * the admin "resend" button.
 */
async function sendOne(bookingId: string, force = false): Promise<{
  sent: boolean;
  skipped?: 'already-sent' | 'not-confirmed' | 'not-found' | 'not-yet' | 'too-old' | 'closed';
}> {
  const ref = db.collection('bookings').doc(bookingId);
  const snap = await ref.get();
  if (!snap.exists) {
    return { sent: false, skipped: 'not-found' };
  }
  const booking = snap.data() as Booking & SentMarker;
  if (!force && booking.postTourFollowupSentAt) {
    return { sent: false, skipped: 'already-sent' };
  }
  if (booking.status !== 'confirmed' && booking.status !== 'completed') {
    return { sent: false, skipped: 'not-confirmed' };
  }
  // Travis closed the departure; it didn't go out.
  if (booking.closure) {
    return { sent: false, skipped: 'closed' };
  }
  // "How was your tour?" only makes sense after it, and not weeks later:
  // this also keeps it from reaching customers of tours from past years.
  const today = marinaNow().date;
  if (booking.date >= today) {
    return { sent: false, skipped: 'not-yet' };
  }
  if (booking.date < addDaysIso(today, -FOLLOWUP_MAX_AGE_DAYS)) {
    return { sent: false, skipped: 'too-old' };
  }

  const adminEmail = ADMIN_EMAIL.value();
  const baseUrl = APP_BASE_URL.value();

  const { subject, html, text } = buildPostTourFollowupEmail({
    booking,
    baseUrl,
    instagramUrl: INSTAGRAM_URL,
    facebookUrl: FACEBOOK_URL,
    googleReviewUrl: GOOGLE_REVIEW_URL || undefined,
    phoneDisplay: PHONE_DISPLAY,
    marina: MARINA,
  });

  // Throws when Resend refuses it.
  const { id } = await sendEmail({
    kind: 'followup',
    bookingId,
    to: booking.customerEmail,
    bcc: adminEmail,
    subject,
    html,
    text,
    replyTo: adminEmail,
    headers: {
      'X-Entity-Ref-ID': bookingId,
      'X-Email-Type': 'post-tour-followup',
    },
  });

  await ref.update({
    postTourFollowupSentAt: FieldValue.serverTimestamp(),
    postTourFollowupMessageId: id,
    updatedAt: FieldValue.serverTimestamp(),
  });

  return { sent: true };
}

/** How many days back each run looks, so a failed send or run gets retried. */
const FOLLOWUP_LOOKBACK_DAYS = 3;

/**
 * Scheduled daily at 07:00 ET. Finds bookings from the last few days
 * (normally just yesterday's) that haven't yet received a follow-up, then
 * sends the email. Tolerates per-booking failures — they're logged, the
 * rest of the batch still completes, and tomorrow's run tries them again.
 */
export const sendPostTourFollowups = onSchedule(
  {
    schedule: 'every day 07:00',
    timeZone: 'America/New_York',
    region: 'us-central1',
    secrets: [RESEND_API_KEY, RESEND_FROM_EMAIL, APP_BASE_URL],
    retryCount: 0,
  },
  async () => {
    // Tour dates before today in the marina's timezone, back a few days.
    const today = marinaNow().date;
    const from = addDaysIso(today, -FOLLOWUP_LOOKBACK_DAYS);

    const snap = await db
      .collection('bookings')
      .where('date', '>=', from)
      .where('date', '<', today)
      .get();

    const candidates = snap.docs
      .map((d) => d.data() as Booking & SentMarker)
      .filter(
        (b) =>
          (b.status === 'confirmed' || b.status === 'completed') &&
          !b.closure &&
          !b.postTourFollowupSentAt,
      );

    logger.info(`Post-tour follow-up batch for ${from} to ${addDaysIso(today, -1)}`, {
      total: snap.size,
      eligible: candidates.length,
    });

    for (const booking of candidates) {
      try {
        await sendOne(booking.id);
      } catch (err) {
        logger.error('Post-tour follow-up failed for booking', {
          bookingId: booking.id,
          err,
        });
      }
    }
  },
);

/**
 * POST /adminSendPostTourFollowup { bookingId, force? }
 *
 * Manual trigger from the admin booking-detail page. If `force=true`,
 * sends even if a follow-up was already sent. Useful for testing or
 * resending a failed one.
 */
export const adminSendPostTourFollowup = onRequest(
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
          force: z.boolean().optional().default(false),
        })
        .safeParse(req.body);
      if (!parsed.success) {
        return badRequest(res, 'Invalid input', parsed.error.format());
      }

      const result = await sendOne(parsed.data.bookingId, parsed.data.force);
      await writeAudit({
        admin,
        action: 'booking.update',
        targetId: parsed.data.bookingId,
        payload: { action: 'send-post-tour-followup', ...result },
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

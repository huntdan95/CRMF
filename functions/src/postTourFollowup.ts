import { onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import { z } from 'zod';

import { db, FieldValue } from './lib/firebase';
import {
  RESEND_API_KEY,
  RESEND_FROM_EMAIL,
  getResend,
  getFromAddress,
} from './lib/resend';
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

// Social + review URLs — kept inline because the function workspace
// doesn't import from src/lib/site-config.ts. Update both when these
// change.
const INSTAGRAM_URL = 'https://www.instagram.com/capt.travisurbin/';
const FACEBOOK_URL = 'https://www.facebook.com/profile.php?id=61554023464570';
// TODO (owner): paste the real Google review URL once the GMB listing is
// claimed. Leave empty until then — the email template handles the absence.
const GOOGLE_REVIEW_URL = '';
const PHONE_DISPLAY = '352-586-7792';

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
  skipped?: 'already-sent' | 'not-confirmed' | 'not-found';
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

  const resend = getResend();
  const from = getFromAddress();
  const adminEmail = ADMIN_EMAIL.value();
  const baseUrl = APP_BASE_URL.value();

  const { subject, html, text } = buildPostTourFollowupEmail({
    booking,
    baseUrl,
    instagramUrl: INSTAGRAM_URL,
    facebookUrl: FACEBOOK_URL,
    googleReviewUrl: GOOGLE_REVIEW_URL || undefined,
    phoneDisplay: PHONE_DISPLAY,
  });

  const { data, error } = await resend.emails.send({
    from,
    to: [booking.customerEmail],
    bcc: [adminEmail],
    subject,
    html,
    text,
    replyTo: adminEmail,
    headers: {
      'X-Entity-Ref-ID': bookingId,
      'X-Email-Type': 'post-tour-followup',
    },
  });

  if (error) {
    throw new Error(`Resend failed: ${error.message ?? 'unknown'}`);
  }

  await ref.update({
    postTourFollowupSentAt: FieldValue.serverTimestamp(),
    postTourFollowupMessageId: data?.id ?? null,
    updatedAt: FieldValue.serverTimestamp(),
  });

  return { sent: true };
}

/**
 * Scheduled daily at 07:00 ET. Finds bookings whose tour date was
 * yesterday and which haven't yet received a follow-up, then sends the
 * email. Tolerates per-booking failures — they're logged and the rest of
 * the batch still completes.
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
    // "Yesterday" in the marina's timezone. We're already running in ET so
    // a plain Date works.
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const yIso =
      `${yesterday.getFullYear()}-` +
      `${String(yesterday.getMonth() + 1).padStart(2, '0')}-` +
      `${String(yesterday.getDate()).padStart(2, '0')}`;

    const snap = await db
      .collection('bookings')
      .where('date', '==', yIso)
      .get();

    const candidates = snap.docs
      .map((d) => d.data() as Booking & SentMarker)
      .filter(
        (b) =>
          (b.status === 'confirmed' || b.status === 'completed') &&
          !b.postTourFollowupSentAt,
      );

    logger.info(`Post-tour follow-up batch for ${yIso}`, {
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

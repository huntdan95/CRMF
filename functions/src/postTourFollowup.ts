import { onRequest } from 'firebase-functions/v2/https';
import { z } from 'zod';

import { db, FieldValue } from './lib/firebase';
import { RESEND_API_KEY, RESEND_FROM_EMAIL } from './lib/resend';
import { APP_BASE_URL } from './lib/config';
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
import { addDays, hoursUntilTour, marinaNow } from './lib/datetime';
import { SLOT_START_TIMES } from './lib/schedule';
import { isMessageable } from './lib/notify';
import { sendGuestOnce } from './lib/guest-send';
import { getAutomationSettings } from './lib/site-settings';

// Social URLs — kept inline because the function workspace doesn't import
// from src/lib/site-config.ts. Update both when these change. The Google
// review link is Travis's to change, in Admin → Settings.
const INSTAGRAM_URL = 'https://www.instagram.com/capt.travisurbin/';
const FACEBOOK_URL = 'https://www.facebook.com/profile.php?id=61554023464570';
const PHONE_DISPLAY = '352-586-7792';

/** Past this many days after the tour, a follow-up is no longer sent. */
const FOLLOWUP_MAX_AGE_DAYS = 14;

export type ReviewRequestSkip =
  | 'already-sent'
  | 'not-confirmed'
  | 'not-found'
  | 'not-yet'
  | 'too-old';

export interface ReviewRequestState {
  postTourFollowupSentAt?: unknown;
  reviewHoldUntil?: FirebaseFirestore.Timestamp | null;
}

/**
 * Sends the "How was your tour?" review request to one booking, once
 * (marker `postTourFollowupSentAt`), and lifts any hold on it. Used by the
 * 7:00 PM run, the held-request run, the review-requests page's Send
 * button, and the booking page's resend (`force`, which sends again).
 *
 * Every guest whose trip ran gets this same request. It's only skipped for
 * a trip that didn't run (no-show, cancelled), a full refund, or a tour
 * that hasn't left yet or was too long ago.
 */
export async function sendReviewRequest(
  bookingId: string,
  opts: { force?: boolean; now?: Date } = {},
): Promise<{ sent: boolean; skipped?: ReviewRequestSkip }> {
  const now = opts.now ?? new Date();
  const ref = db.collection('bookings').doc(bookingId);
  const snap = await ref.get();
  if (!snap.exists) {
    return { sent: false, skipped: 'not-found' };
  }
  const booking = { ...(snap.data() as Booking & ReviewRequestState), id: snap.id };
  if (!opts.force && booking.postTourFollowupSentAt) {
    return { sent: false, skipped: 'already-sent' };
  }
  if (!isMessageable(booking)) {
    return { sent: false, skipped: 'not-confirmed' };
  }
  // "How was your tour?" only once the boat has left, and not weeks later:
  // this also keeps it from reaching customers of tours from past years.
  const today = marinaNow(now).date;
  if (booking.date > today || hoursUntilTour(booking.date, SLOT_START_TIMES[booking.timeSlot], now) > 0) {
    return { sent: false, skipped: 'not-yet' };
  }
  if (booking.date < addDays(today, -FOLLOWUP_MAX_AGE_DAYS)) {
    return { sent: false, skipped: 'too-old' };
  }

  const { googleReviewUrl } = await getAutomationSettings();
  const email = buildPostTourFollowupEmail({
    booking,
    baseUrl: APP_BASE_URL.value(),
    instagramUrl: INSTAGRAM_URL,
    facebookUrl: FACEBOOK_URL,
    googleReviewUrl,
    phoneDisplay: PHONE_DISPLAY,
    sentOn: today,
  });

  const result = await sendGuestOnce(
    booking,
    'postTourFollowupSentAt',
    {
      type: 'post-tour-followup',
      // A deliberate resend is a new email; the scheduled sends share one key.
      key: opts.force ? `review-request/${bookingId}/resend-${now.getTime()}` : `review-request/${bookingId}`,
      ...email,
    },
    { bccOwner: true, force: opts.force },
  );
  if (!result.sent) {
    return { sent: false, skipped: result.reason === 'already-sent' ? 'already-sent' : 'not-confirmed' };
  }
  if (booking.reviewHoldUntil) {
    await ref.update({ reviewHoldUntil: null, updatedAt: FieldValue.serverTimestamp() });
  }
  return { sent: true };
}

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

      const result = await sendReviewRequest(parsed.data.bookingId, { force: parsed.data.force });
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

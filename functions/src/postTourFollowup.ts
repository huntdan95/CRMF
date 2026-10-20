import { onRequest } from 'firebase-functions/v2/https';
import { z } from 'zod';

import { db, FieldValue } from './lib/firebase';
import { RESEND_API_KEY, RESEND_FROM_EMAIL } from './lib/resend';
import { APP_BASE_URL } from './lib/config';
import { buildPostTourFollowupEmail } from './lib/email-templates';
import { galleryUrl } from './lib/guest-templates';
import { UPLOAD_WINDOW_DAYS } from './lib/trip-photos';
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
import { SLOT_MINUTES, slotStartTime } from './lib/schedule';
import { isMessageable } from './lib/notify';
import { sendGuestOnce } from './lib/guest-send';
import { getAutomationSettings } from './lib/site-settings';
import { closedDeparturesOn } from './lib/close-day';

// Social URLs — kept inline because the function workspace doesn't import
// from src/lib/site-config.ts. Update both when these change. The Google
// review link is Travis's to change, in Admin → Settings.
const INSTAGRAM_URL = 'https://www.instagram.com/capt.travisurbin/';
const FACEBOOK_URL = 'https://www.facebook.com/profile.php?id=61554023464570';
const PHONE_DISPLAY = '352-586-7792';
const MARINA = {
  name: "Pete's Pier Marina",
  address: '1 SW First Place, Crystal River, FL 34429',
};

/** Past this many days after the tour, a follow-up is no longer sent. */
const FOLLOWUP_MAX_AGE_DAYS = 14;

export type ReviewRequestSkip =
  | 'already-sent'
  | 'not-confirmed'
  | 'not-found'
  | 'not-yet'
  | 'too-old'
  | 'closed'
  | 'suppressed';

/** The admin page's name for the same skips. */
export type FollowupSkipped = ReviewRequestSkip;

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
 * a trip that didn't run (no-show, cancelled, closed), a full refund, or a
 * tour that isn't back yet or was too long ago.
 */
export async function sendReviewRequest(
  bookingId: string,
  opts: { force?: boolean; now?: Date; idempotencyKey?: string } = {},
): Promise<{ sent: boolean; skipped?: ReviewRequestSkip }> {
  const now = opts.now ?? new Date();
  const ref = db.collection('bookings').doc(bookingId);
  const snap = await ref.get();
  if (!snap.exists) {
    return { sent: false, skipped: 'not-found' };
  }
  const booking = { ...(snap.data() as Booking & ReviewRequestState & { photosSentAt?: unknown }), id: snap.id };
  if (!opts.force && booking.postTourFollowupSentAt) {
    return { sent: false, skipped: 'already-sent' };
  }
  // Travis closed the departure; it didn't go out.
  if (booking.closure) {
    return { sent: false, skipped: 'closed' };
  }
  if (!isMessageable(booking)) {
    return { sent: false, skipped: 'not-confirmed' };
  }
  // They marked one of our emails as spam (resendWebhook). The request
  // invites a rebooking, so the scheduled runs leave them out; Travis can
  // still send it by hand.
  if (!opts.force && booking.marketingSuppressed) {
    return { sent: false, skipped: 'suppressed' };
  }
  // "How was your tour?" only once the boat is back, and not weeks later:
  // this also keeps it from reaching customers of tours from past years.
  // The sunset cruise is often still out at the 7:00 PM run; the next
  // morning's run for missed ones sends theirs ("yesterday").
  const today = marinaNow(now).date;
  const hoursUntilBack =
    hoursUntilTour(booking.date, slotStartTime(booking.timeSlot, booking.date), now) + SLOT_MINUTES[booking.timeSlot] / 60;
  if (booking.date > today || hoursUntilBack > 0) {
    return { sent: false, skipped: 'not-yet' };
  }
  if (booking.date < addDays(today, -FOLLOWUP_MAX_AGE_DAYS)) {
    return { sent: false, skipped: 'too-old' };
  }
  // Travis closed the departure and left them booked, to call them: it
  // didn't go out either, unless he's marked it completed since.
  if (booking.status !== 'completed' && (await closedDeparturesOn(db, booking.date))(booking.timeSlot)) {
    return { sent: false, skipped: 'closed' };
  }

  const { googleReviewUrl } = await getAutomationSettings();
  const baseUrl = APP_BASE_URL.value();
  // The photos email goes from the morning after the trip, for up to
  // UPLOAD_WINDOW_DAYS (sendTripPhotos). A request Travis held, or sends
  // again, can come after it: then it links their gallery instead of
  // promising photos, and past that window, with none sent, says nothing.
  const gallery = booking.photosSentAt ? galleryUrl(baseUrl, booking) : null;
  const photos = gallery
    ? { galleryUrl: gallery }
    : booking.photosSentAt || booking.date < addDays(today, -UPLOAD_WINDOW_DAYS)
      ? ('none' as const)
      : ('coming' as const);
  const email = buildPostTourFollowupEmail({
    booking,
    baseUrl,
    instagramUrl: INSTAGRAM_URL,
    facebookUrl: FACEBOOK_URL,
    googleReviewUrl,
    phoneDisplay: PHONE_DISPLAY,
    marina: MARINA,
    sentOn: today,
    photos,
  });

  const result = await sendGuestOnce(
    booking,
    'postTourFollowupSentAt',
    {
      type: 'post-tour-followup',
      kind: 'followup',
      // A deliberate resend is a new email; the scheduled sends share one key.
      key:
        opts.idempotencyKey ??
        (opts.force ? `review-request/${bookingId}/resend-${now.getTime()}` : `review-request/${bookingId}`),
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
 * The same request under its older name: "Fix email and resend" in admin
 * (adminFixEmail.ts) sends it again, with its own idempotency key.
 */
export function sendPostTourFollowupEmail(
  bookingId: string,
  force = false,
  opts: { idempotencyKey?: string } = {},
): Promise<{ sent: boolean; skipped?: FollowupSkipped }> {
  return sendReviewRequest(bookingId, { force, idempotencyKey: opts.idempotencyKey });
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

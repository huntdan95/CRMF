import { onRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { z } from 'zod';

import { db, FieldValue, Timestamp } from './lib/firebase';
import { RESEND_API_KEY, RESEND_FROM_EMAIL } from './lib/resend';
import { APP_BASE_URL } from './lib/config';
import { applyCors, badRequest, methodNotAllowed, serverError } from './lib/http';
import { notifyOwner } from './lib/notify';
import { buildFeedbackEmail } from './lib/owner-templates';
import type { Booking } from './lib/types';

/*
 * "Something not right? Tell Travis privately": the short form linked next
 * to the Google review link in the thank-you email (/feedback/[id]?t=…).
 * It's saved in `guestFeedback/{id}` (admin-readable) and emailed to Travis
 * right away, with replies going to the guest. If that email fails, the
 * hourly review-request run tries it again (`emailedAt` stays null).
 */

/** Plenty for an honest follow-up; stops a link from being used as a spam cannon. */
const MAX_PER_BOOKING = 5;

const schema = z.object({
  bookingId: z.string().min(1).max(64),
  accessToken: z.string().min(8).max(64),
  message: z.string().trim().min(1).max(4000),
});

async function emailTravis(feedbackId: string): Promise<boolean> {
  const ref = db.collection('guestFeedback').doc(feedbackId);
  const doc = (await ref.get()).data() as { bookingId: string; message: string; emailedAt: unknown } | undefined;
  if (!doc || doc.emailedAt) return false;
  const booking = (await db.collection('bookings').doc(doc.bookingId).get()).data() as Booking | undefined;
  if (!booking) return false;
  const email = buildFeedbackEmail({ booking, message: doc.message, baseUrl: APP_BASE_URL.value() });
  await notifyOwner({
    type: 'guest-feedback',
    key: `guest-feedback/${feedbackId}`,
    refId: booking.id,
    replyTo: booking.customerEmail,
    ...email,
  });
  await ref.update({ emailedAt: FieldValue.serverTimestamp() });
  return true;
}

/** POST /submitFeedback { bookingId, accessToken, message } */
export const submitFeedback = onRequest(
  {
    cors: false,
    secrets: [RESEND_API_KEY, RESEND_FROM_EMAIL, APP_BASE_URL],
    maxInstances: 5,
  },
  async (req, res) => {
    if (applyCors(req, res)) return;
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return badRequest(res, 'Write a message first.', parsed.error.format());
    const { bookingId, accessToken, message } = parsed.data;

    try {
      const booking = (await db.collection('bookings').doc(bookingId).get()).data() as Booking | undefined;
      if (!booking || booking.accessToken !== accessToken) {
        res.status(403).json({ error: 'This link doesn’t work. Call or text Travis at 352-586-7792 instead.' });
        return;
      }

      const ref = db.collection('guestFeedback').doc();
      const accepted = await db.runTransaction(async (tx) => {
        const earlier = await tx.get(db.collection('guestFeedback').where('bookingId', '==', bookingId));
        if (earlier.size >= MAX_PER_BOOKING) return false;
        tx.set(ref, {
          bookingId,
          customerName: booking.customerName,
          customerEmail: booking.customerEmail,
          tripDate: booking.date,
          timeSlot: booking.timeSlot,
          message,
          createdAt: FieldValue.serverTimestamp(),
          emailedAt: null,
        });
        return true;
      });
      if (!accepted) {
        res.status(429).json({ error: 'Travis has your earlier messages. Call or text him at 352-586-7792 to add more.' });
        return;
      }

      try {
        await emailTravis(ref.id);
      } catch (err) {
        // Saved either way; the hourly retry sends it.
        logger.error('Feedback email to Travis failed', { feedbackId: ref.id, err });
      }
      res.status(200).json({ ok: true });
    } catch (err) {
      serverError(res, err);
    }
  },
);

/** Emails Travis any feedback from the last day whose email didn't go out. */
export async function retryFeedbackEmails(now: Date): Promise<number> {
  const since = Timestamp.fromMillis(now.getTime() - 24 * 60 * 60 * 1000);
  const snap = await db.collection('guestFeedback').where('createdAt', '>=', since).get();
  let sent = 0;
  for (const d of snap.docs) {
    if (d.get('emailedAt')) continue;
    try {
      if (await emailTravis(d.id)) sent++;
    } catch (err) {
      logger.error('Feedback email retry failed', { feedbackId: d.id, err });
    }
  }
  return sent;
}

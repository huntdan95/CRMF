import { onDocumentCreated, onDocumentWritten } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions/v2';

import { db, FieldValue } from './lib/firebase';
import { VAPID_PRIVATE_KEY, sendAdminPush, type CrewPush } from './lib/crew-push';
import { emailKindLabel } from './lib/email-log';
import { formatPrice, slotLabels } from './lib/tours';
import { departureLabel, guestsLabel, shortDate } from './lib/trip-format';
import { isLegacyBooking, type Booking, type TourTimeSlot } from './lib/types';

/*
 * Push notifications to Travis's admin app (installed from /admin, see
 * public/admin-sw.js and src/components/admin/AdminNotifications.tsx), for
 * the things he has to act on or wants to know straight away. Each one
 * opens the admin page to deal with it. A push that fails is logged and
 * nothing else: the emails he already gets still go.
 *
 *   New booking, customer cancellation, email bounced   bookings/{id}
 *   Contact-form message                                contactMessages/{id}
 *   Reschedule request                                  rescheduleRequests/{id}
 *   Private feedback after a trip                       guestFeedback/{id}
 *   Tonight's review requests (6 PM)                    reviewLists/{date}
 *   "Send a test" in Admin → Settings                   adminPushTests/{id}
 */

const TRIGGER_OPTS = {
  region: 'us-central1',
  secrets: [VAPID_PRIVATE_KEY],
  retry: false,
  maxInstances: 5,
};

async function push(what: string, message: CrewPush): Promise<void> {
  try {
    const result = await sendAdminPush(message);
    logger.info(`Admin push: ${what}`, { tag: message.tag, ...result });
  } catch (err) {
    logger.error(`Admin push failed: ${what}`, { tag: message.tag, err });
  }
}

/** "Hello there…" past `max` characters. */
function excerpt(text: string, max = 140): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

/** What to push for one booking write, or nothing. Pure, for testing. */
export function bookingPushes(
  bookingId: string,
  before: Booking | undefined,
  after: Booking | undefined,
): CrewPush[] {
  if (!after) return [];
  const b = { ...after, id: bookingId };
  const url = `/admin/bookings/${bookingId}`;
  const when = `${shortDate(b.date)}, ${departureLabel(b)}`;
  const out: CrewPush[] = [];

  // Paid for. Old-site bookings arrive confirmed by the hundred from the
  // import script; they aren't news.
  if (b.status === 'confirmed' && before?.status !== 'confirmed' && !isLegacyBooking(b)) {
    out.push({
      title: `New booking: ${when}`,
      body: [b.customerName, guestsLabel(b.guestCount), b.amountPaidCents > 0 ? formatPrice(b.amountPaidCents) : null]
        .filter(Boolean)
        .join(' · '),
      url,
      tag: `booking-${bookingId}`,
    });
  }

  // The customer cancelled from their booking page. Travis's own cancels
  // and closures don't need telling.
  if (before?.status === 'confirmed' && b.status === 'cancelled' && b.cancelledBy === 'customer') {
    const refund = b.amountRefundedCents ?? 0;
    out.push({
      title: `Cancelled: ${when}`,
      body: [b.customerName, guestsLabel(b.guestCount), refund > 0 ? `${formatPrice(refund)} refunded` : 'No refund']
        .filter(Boolean)
        .join(' · '),
      url,
      tag: `booking-${bookingId}`,
    });
  }

  // A bounce alert email just went to Travis (lib/email-events.ts marks
  // it once per booking per kind of email).
  const alerted = Object.keys(b.bounceAlertSentAt ?? {}).filter((kind) => !before?.bounceAlertSentAt?.[kind]);
  for (const kind of alerted) {
    out.push({
      title: `Email bounced: call ${b.customerName || 'the customer'}`,
      body: `Their ${emailKindLabel(kind)} didn’t arrive (${b.customerEmail}). ${when}.`,
      url,
      tag: `bounce-${bookingId}-${kind}`,
    });
  }
  return out;
}

export const notifyAdminOfBooking = onDocumentWritten(
  { ...TRIGGER_OPTS, document: 'bookings/{bookingId}' },
  async (event) => {
    const pushes = bookingPushes(
      event.params.bookingId,
      event.data?.before.data() as Booking | undefined,
      event.data?.after.data() as Booking | undefined,
    );
    for (const p of pushes) await push(p.title, p);
  },
);

export const notifyAdminOfContactMessage = onDocumentCreated(
  { ...TRIGGER_OPTS, document: 'contactMessages/{messageId}' },
  async (event) => {
    const m = event.data?.data() as
      | { name?: string; subject?: string | null; message?: string; notify?: boolean }
      | undefined;
    // Over the site's hourly limit (a flood): saved for the inbox only, like
    // the email (onContactMessage.ts).
    if (!m || m.notify === false) return;
    await push('contact message', {
      title: `Message from ${m.name || 'the website'}`,
      body: excerpt([m.subject, m.message].filter(Boolean).join(': ')),
      url: '/admin/messages',
      tag: `message-${event.params.messageId}`,
    });
  },
);

export const notifyAdminOfRescheduleRequest = onDocumentCreated(
  { ...TRIGGER_OPTS, document: 'rescheduleRequests/{requestId}' },
  async (event) => {
    const r = event.data?.data() as
      | { bookingId: string; requestedDate: string; requestedSlot?: TourTimeSlot | null }
      | undefined;
    if (!r) return;
    const snap = await db.collection('bookings').doc(r.bookingId).get();
    if (!snap.exists) return;
    const b = { ...(snap.data() as Booking), id: snap.id };
    const wants = `${shortDate(r.requestedDate)}${r.requestedSlot ? `, ${slotLabels[r.requestedSlot] ?? r.requestedSlot}` : ''}`;
    await push('reschedule request', {
      title: `Reschedule request: ${b.customerName}`,
      body: `${shortDate(b.date)}, ${departureLabel(b)} → wants ${wants}`,
      url: '/admin/reschedules',
      tag: `reschedule-${event.params.requestId}`,
    });
  },
);

export const notifyAdminOfFeedback = onDocumentCreated(
  { ...TRIGGER_OPTS, document: 'guestFeedback/{feedbackId}' },
  async (event) => {
    const f = event.data?.data() as { bookingId: string; customerName?: string; message?: string } | undefined;
    if (!f) return;
    await push('private feedback', {
      title: `Private feedback from ${f.customerName || 'a guest'}`,
      body: excerpt(f.message ?? ''),
      url: `/admin/bookings/${f.bookingId}`,
      tag: `feedback-${event.params.feedbackId}`,
    });
  },
);

export const notifyAdminOfReviewList = onDocumentCreated(
  { ...TRIGGER_OPTS, document: 'reviewLists/{date}' },
  async (event) => {
    const going = (event.data?.get('going') as number | undefined) ?? 0;
    if (going === 0) return;
    await push('review list', {
      title: `${going} review ${going === 1 ? 'request goes' : 'requests go'} out at 7:00`,
      body: 'Mark anyone who didn’t sail, or hold one to call them first.',
      url: '/admin/review-requests',
      tag: `review-list-${event.params.date}`,
    });
  },
);

/**
 * "Send a test" in Admin → Settings writes `adminPushTests/{id}` with the
 * admin's email (src/app/api/admin/push/test/route.ts); this pushes to that
 * admin's devices and records how it went on the same doc.
 */
export const sendAdminTestPush = onDocumentCreated(
  { ...TRIGGER_OPTS, document: 'adminPushTests/{testId}' },
  async (event) => {
    const email = event.data?.get('email') as string | undefined;
    if (!event.data || !email) return;
    try {
      const result = await sendAdminPush(
        {
          title: 'Notifications are working',
          body: 'You’ll get one of these for new bookings, cancellations, messages and anything else to act on.',
          url: '/admin',
          tag: 'admin-test',
        },
        { email },
      );
      await event.data.ref.update({ ...result, processedAt: FieldValue.serverTimestamp() });
    } catch (err) {
      logger.error('Failed to send admin test push', { email, err });
      await event.data.ref.update({
        error: err instanceof Error ? err.message : 'unknown',
        processedAt: FieldValue.serverTimestamp(),
      });
    }
  },
);

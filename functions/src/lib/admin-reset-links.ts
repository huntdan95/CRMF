import { createHash, randomUUID } from 'node:crypto';
import { logger } from 'firebase-functions/v2';
import type { Firestore } from 'firebase-admin/firestore';

import { db as defaultDb, FieldValue } from './firebase';
import { writeAudit, type AdminContext } from './admin-auth';
import { awaitingMove } from './closure';
import { closedDeparturesOn, markClosureField } from './close-day';
import { APP_BASE_URL } from './config';
import { customerMailer } from './customer-mailer';
import { marinaNow } from './datetime';
import type { EmailDeps } from './email-log';
import { buildClosureOfferEmail } from './email-templates';
import { resendBookingConfirmation } from './send-confirmation';
import { onTheBoat, resendTripPhotosEmail } from './trip-photos';
import { isLegacyBooking, type Booking } from './types';

/** The email that carries the new links. */
export type ResetLinksEmailKind = 'confirmation' | 'closureOffer' | 'photos';

export type ResetLinksEmail =
  | { outcome: 'sent'; kind: ResetLinksEmailKind; to: string }
  /** Resend refused it. The links were reset all the same. */
  | { outcome: 'failed'; kind: ResetLinksEmailKind; to: string; reason: string }
  /** No email fits the booking as it stands; `reason` says why, in plain English. */
  | { outcome: 'skipped'; reason: string };

export type AdminResetLinksOutcome =
  | { kind: 'reset'; email: ResetLinksEmail }
  | { kind: 'not-found' }
  /** Booked on this site and still in Stripe Checkout, which sends them back with the old token. */
  | { kind: 'still-paying' };

/** How the new links go out. Each throws if the email isn't sent. */
export interface ResetLinksPaths {
  /** The booking confirmation, the way "Email the confirmation again" sends it. */
  confirmation(booking: Booking): Promise<void>;
  /** The "pick a new date or a refund" email, as closing the day sent it. */
  closureOffer(booking: Booking, idempotencyKey: string): Promise<void>;
  /** The photos email, with the new gallery link; not sent if the gallery is empty now. */
  photos(booking: Booking, idempotencyKey: string): Promise<{ sent: boolean }>;
}

/**
 * Admin's "Reset their booking links", for when an email went to the wrong
 * person. The booking gets a new accessToken, so everything made from the
 * old one stops working at once: the manage link (/my-booking?t=, and with
 * it fetchBooking, cancelBooking, requestReschedule and moveClosedBooking),
 * the confirmation page and its .ics download, the photo gallery
 * (/my-booking/<id>/photos?t=, and the photos email's ?k=, a hash of the
 * token, see lib/gallery-link.ts; their downloads too), the private-feedback link
 * in the "thanks for coming" email (/feedback/<id>?t=), and every waiver
 * signing link, forwarded ones included (?k= is a hash of the token, see
 * lib/waiver-link.ts). Waivers already signed stay signed, and each signer's
 * link to their own copy has its own key, so it keeps working.
 *
 * Then the email that fits the booking goes to the address on it now, with
 * the new links: the confirmation for a confirmed trip still to come, on a
 * departure Travis hasn't closed, the "pick a new date" offer while they're
 * choosing after he closed it, or, after the trip, the photos email again if
 * they'd had one. Anything else (cancelled, over with no photos email, an
 * old-site reservation, a departure he closed and left them booked on, no
 * address) gets nothing, and the answer says why, so Travis knows to call.
 * The "thanks for coming" email isn't sent again here; the booking page's
 * own button does that.
 *
 * Not while a customer is still paying online: Stripe sends them back to
 * the confirmation page with the token it was given, and their browser
 * keeps it to let go of the hold. Nothing has been emailed by then anyway.
 *
 * Admin site only, not MCP: whoever holds the token can cancel and refund
 * the booking.
 */
export async function adminResetLinksOne(
  bookingId: string,
  admin: AdminContext,
  deps: {
    db?: Firestore;
    now?: Date;
    paths: ResetLinksPaths;
    audit?: typeof writeAudit;
  },
): Promise<AdminResetLinksOutcome> {
  const db = deps.db ?? defaultDb;
  const ref = db.collection('bookings').doc(bookingId);
  // Made the way createCheckoutSession makes the first one.
  const accessToken = randomUUID();

  const rotated = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { kind: 'not-found' as const };
    const booking = { ...(snap.data() as Booking), id: bookingId };
    if (booking.status === 'pending-payment' && !isLegacyBooking(booking)) {
      return { kind: 'still-paying' as const };
    }
    tx.update(ref, { accessToken, updatedAt: FieldValue.serverTimestamp() });
    return { kind: 'rotated' as const, booking: { ...booking, accessToken } };
  });
  if (rotated.kind !== 'rotated') return rotated;

  const closed = (await closedDeparturesOn(db, rotated.booking.date))(rotated.booking.timeSlot);
  const email = await emailNewLinks(rotated.booking, marinaNow(deps.now).date, closed, deps.paths);
  // The offer had never gone (Resend refused it when the closure went out):
  // it has now, so the booking page stops saying it wasn't sent, and the
  // hourly resend (resendClosureOffers), under its own key, doesn't send it
  // a second time.
  const closure = rotated.booking.closure;
  if (email.outcome === 'sent' && email.kind === 'closureOffer' && closure && !closure.offerEmailedAt) {
    await markClosureField(db, bookingId, closure.blackoutId, 'offerEmailedAt', deps.now).catch((err) =>
      logger.error('Couldn’t record the closure offer as emailed', { bookingId, err }),
    );
  }

  // Never the token: the log says what happened, not how to get in.
  await (deps.audit ?? writeAudit)({
    admin,
    action: 'booking.update',
    targetId: bookingId,
    payload: { action: 'reset-links', email },
  });
  return { kind: 'reset', email };
}

/**
 * Which email the booking gets, by the same rules as "Fix email and resend".
 * `closed`: a blackout covers its departure.
 */
function emailFor(b: Booking, today: string, closed: boolean): { kind: ResetLinksEmailKind } | { skipped: string } {
  if (awaitingMove(b)) {
    // After decideBy they can't move it online, and the refund is on its
    // way, unless Stripe turned it down.
    if (b.closure!.decideBy >= today) return { kind: 'closureOffer' };
    return {
      skipped: b.closure!.refundRefused
        ? 'The time to pick a new date has passed, and Stripe turned down their refund: call them.'
        : 'The time to pick a new date has passed, so they’re being refunded.',
    };
  }
  // After the trip, the link they still use is the photo gallery's, if the
  // photos email had gone (sendTripPhotos never sends twice by itself).
  if (b.date < today && (b as Booking & { photosSentAt?: unknown }).photosSentAt && onTheBoat(b)) {
    return { kind: 'photos' };
  }
  switch (b.status) {
    case 'confirmed':
      if (b.date < today) return { skipped: 'The trip date has passed.' };
      // Closed and left booked (or closed from MCP): "locked in" would tell
      // them it's going ahead.
      return closed
        ? { skipped: 'You closed that departure, and a confirmation would tell them it’s still on.' }
        : { kind: 'confirmation' };
    case 'pending-payment':
      return { skipped: 'It’s an old-website reservation, not a confirmed booking, so there’s no confirmation to send.' };
    case 'cancelled':
      return { skipped: 'The booking is cancelled.' };
    default:
      return { skipped: 'The trip is over.' };
  }
}

async function emailNewLinks(b: Booking, today: string, closed: boolean, paths: ResetLinksPaths): Promise<ResetLinksEmail> {
  const pick = emailFor(b, today, closed);
  if ('skipped' in pick) return { outcome: 'skipped', reason: pick.skipped };
  if (!b.customerEmail) return { outcome: 'skipped', reason: 'There’s no email address on the booking.' };
  const to = b.customerEmail;
  // One per new token, so a repeat of this send goes once. A hash, so the
  // key Resend keeps can't be turned back into the token.
  const key = `reset-links/${b.id}/${createHash('sha256').update(b.accessToken).digest('hex').slice(0, 16)}`;
  try {
    if (pick.kind === 'confirmation') await paths.confirmation(b);
    else if (pick.kind === 'closureOffer') await paths.closureOffer(b, key);
    else if (!(await paths.photos(b, `${key}/photos`)).sent) {
      return { outcome: 'skipped', reason: 'The trip is over, and there’s nothing in their photo gallery now.' };
    }
    return { outcome: 'sent', kind: pick.kind, to };
  } catch (err) {
    logger.error('Emailing the reset booking links failed', { bookingId: b.id, kind: pick.kind, err });
    return {
      outcome: 'failed',
      kind: pick.kind,
      to,
      reason: err instanceof Error && err.message.startsWith('Resend failed') ? err.message : 'It didn’t send.',
    };
  }
}

/**
 * The real sends: the paths "Fix email and resend" uses (adminFixEmail.ts).
 * Each builds the email from the booking as it is now, new token included,
 * and copies Travis.
 */
export function resetLinksPaths(adminEmail: string, deps: EmailDeps = {}): ResetLinksPaths {
  return {
    // Re-reads the booking, so it has the new token and the address on it now.
    confirmation: (b) => resendBookingConfirmation(b.id, deps),
    async closureOffer(b, idempotencyKey) {
      const mailer = customerMailer({ adminEmail, deps });
      const { subject, html, text } = buildClosureOfferEmail({
        booking: b,
        reason: b.closure!.reason,
        decideBy: b.closure!.decideBy,
        baseUrl: APP_BASE_URL.value(),
        phoneDisplay: mailer.phoneDisplay,
        marina: mailer.marina,
      });
      await mailer.send({ kind: 'closureOffer', bookingId: b.id, to: b.customerEmail, subject, html, text, idempotencyKey });
    },
    photos: (b, idempotencyKey) => resendTripPhotosEmail(b, { adminEmail, idempotencyKey, deps }),
  };
}

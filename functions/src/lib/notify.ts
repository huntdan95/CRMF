import { logger } from 'firebase-functions/v2';

import { db } from './firebase';
import { isEmailSendError, sendEmail, type EmailKind, type SendEmailInput } from './email-log';
import { ADMIN_EMAIL, SEND_TOUR_REMINDERS } from './config';
import { isLegacyBooking, type Booking } from './types';

/*
 * The one way the site's automated messages go out: crew alerts, trip prep,
 * directions, review requests, photo emails, and Travis's own notices.
 *
 * Today every message is an email, through sendEmail (lib/email-log.ts) so
 * it's logged and its bounces are followed. Each recipient is
 * reached through {@link CHANNELS}, so a text-message channel can be added
 * there later (crew phones are already stored) without touching the jobs
 * that send. A message can carry its own short `sms` wording for that day.
 */

export interface Message {
  /** Machine name for logs and the X-Email-Type header, e.g. `crew-new-booking`. */
  type: string;
  /**
   * The email log's kind for a guest message (`prep`, `followup`…). Crew
   * messages are always logged as `crew` and Travis's as `admin`.
   */
  kind?: EmailKind;
  subject: string;
  text: string;
  html: string;
  /** One or two sentences for a future text channel. Unused while the site only emails. */
  sms?: string;
  /** Where replies go. Travis by default. */
  replyTo?: string;
  /**
   * Stable id for this message, e.g. `trip-prep/<bookingId>`. Resend drops
   * a repeat with the same key for 24 hours, so a retried job can't send
   * twice even if writing its sent-at marker failed. Each recipient gets
   * their own key from it.
   */
  key: string;
  /** Booking (or other) id, sent as X-Entity-Ref-ID. */
  refId?: string;
}

export interface Recipient {
  /** Stable id for the recipient (crew id, booking id, `owner`). */
  id: string;
  /** Who they are, for the email log: a booking's guest, crew, or Travis. */
  role: 'guest' | 'crew' | 'owner';
  name: string;
  email: string | null;
  /** Stored for a future text channel; nothing sends to it yet. */
  phone: string | null;
}

interface SendOptions {
  /** Copy Travis (bcc) on an email to someone else. */
  bccOwner?: boolean;
  /** Travis sent it by hand: an old-site booking gets it before launch too. */
  evenBeforeLaunch?: boolean;
}

interface Channel {
  name: string;
  canReach(to: Recipient): boolean;
  /** Sends, or throws. Returns the provider's message id. */
  send(to: Recipient, message: Message, opts: SendOptions): Promise<string | null>;
}

const emailChannel: Channel = {
  name: 'email',
  canReach: (to) => !!to.email,
  async send(to, message, opts) {
    const adminEmail = ADMIN_EMAIL.value();
    // Only a guest's email is about the booking's address, so only it is
    // logged against the booking (a bounce there flags the booking).
    const email: SendEmailInput = {
      kind: to.role === 'crew' ? 'crew' : to.role === 'owner' ? 'admin' : (message.kind ?? message.type),
      ...(to.role === 'guest' && { bookingId: to.id }),
      ...(to.role === 'crew' && { crewId: to.id }),
      to: to.email!,
      ...(opts.bccOwner && to.email!.toLowerCase() !== adminEmail.toLowerCase() && { bcc: adminEmail }),
      subject: message.subject,
      html: message.html,
      text: message.text,
      replyTo: message.replyTo ?? adminEmail,
      headers: {
        'X-Email-Type': message.type,
        ...(message.refId ? { 'X-Entity-Ref-ID': message.refId } : {}),
      },
    };
    try {
      return (await sendEmail({ ...email, idempotencyKey: `${message.key}/${to.id}` })).id;
    } catch (err) {
      if (!isEmailSendError(err, 'invalid_idempotent_request')) throw err;
      // Same key, different content (the booking changed since a failed
      // try): it's a new email now, so send it without one.
      return (await sendEmail(email)).id;
    }
  },
};

/** Every way a message can reach someone. A text channel goes here. */
const CHANNELS: Channel[] = [emailChannel];

/**
 * Sends `message` to one person on every channel that can reach them.
 * Throws if none can, or if every channel that tried failed.
 */
async function deliver(to: Recipient, message: Message, opts: SendOptions = {}): Promise<string | null> {
  const channels = CHANNELS.filter((c) => c.canReach(to));
  if (channels.length === 0) throw new Error(`No way to reach ${to.name}`);
  let firstId: string | null = null;
  let lastError: unknown = null;
  let delivered = 0;
  for (const channel of channels) {
    try {
      const id = await channel.send(to, message, opts);
      firstId ??= id;
      delivered++;
    } catch (err) {
      lastError = err;
      logger.error(`${message.type}: ${channel.name} to ${to.id} failed`, { err });
    }
  }
  if (delivered === 0) throw lastError;
  return firstId;
}

/* -------------------------------------------------------------------------- */
/* Guests                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * An old-site booking held with a deposit: imported as `pending-payment`,
 * but a real guest (the admin dashboard and crew app count them too). A
 * new-site `pending-payment` is someone still in Stripe checkout.
 */
export function isLegacyDeposit(b: Pick<Booking, 'id' | 'status'>): boolean {
  return b.status === 'pending-payment' && b.id.startsWith('legacy-');
}

/** A booking whose guests are going out on the boat (before the trip). */
export function isGoing(b: Pick<Booking, 'id' | 'status'>): boolean {
  return b.status === 'confirmed' || isLegacyDeposit(b);
}

/**
 * Whether a booking's guests get automated messages: confirmed or
 * completed (the trip ran, or will), not fully refunded, and not on a
 * departure Travis called off (`closure`; the closing-a-day emails cover
 * those). Old-site deposit bookings count as confirmed.
 */
export function isMessageable(
  b: Pick<Booking, 'id' | 'status' | 'paymentStatus' | 'amountPaidCents' | 'amountRefundedCents' | 'closure'>,
): boolean {
  if (b.status !== 'confirmed' && b.status !== 'completed' && !isLegacyDeposit(b)) return false;
  if (b.closure) return false;
  if (b.paymentStatus === 'refunded') return false;
  return !(b.amountPaidCents > 0 && (b.amountRefundedCents ?? 0) >= b.amountPaidCents);
}

/**
 * Whether {@link notifyGuest} will email this booking today: messageable,
 * and for an old-site booking, only once the launch switch is on.
 */
export function getsAutomatedEmail(
  b: Parameters<typeof isMessageable>[0] & Pick<Booking, 'legacy'>,
): boolean {
  return isMessageable(b) && (!isLegacyBooking(b) || SEND_TOUR_REMINDERS.value());
}

export type GuestSendResult =
  | { sent: true; id: string | null }
  | { sent: false; reason: 'not-eligible' | 'no-contact' | 'before-launch' };

/**
 * Sends a message to a booking's lead guest. Skips (without throwing) a
 * booking that shouldn't get messages; throws if sending fails, so the
 * caller leaves its sent-at marker unset and tries again later.
 */
export async function notifyGuest(
  booking: Booking,
  message: Message,
  opts: SendOptions = {},
): Promise<GuestSendResult> {
  if (!isMessageable(booking)) return { sent: false, reason: 'not-eligible' };
  // Old-site bookings may have been changed or cancelled on the old site
  // since they were imported: nothing automated until launch.
  if (isLegacyBooking(booking) && !opts.evenBeforeLaunch && !SEND_TOUR_REMINDERS.value()) {
    return { sent: false, reason: 'before-launch' };
  }
  const to: Recipient = {
    id: booking.id,
    role: 'guest',
    name: booking.customerName,
    email: booking.customerEmail || null,
    phone: booking.customerPhone || null,
  };
  if (!CHANNELS.some((c) => c.canReach(to))) return { sent: false, reason: 'no-contact' };
  const id = await deliver(to, { refId: booking.id, ...message }, opts);
  return { sent: true, id };
}

/* -------------------------------------------------------------------------- */
/* Crew                                                                       */
/* -------------------------------------------------------------------------- */

export type CrewRole = 'captain' | 'mate';

/** A `crew/{id}` doc as the alerts read it. Older docs lack role/phone/alertsOn. */
interface CrewDoc {
  name: string;
  email?: string | null;
  phone?: string | null;
  role?: CrewRole;
  alertsOn?: boolean;
}

/** Crew with alerts on. Someone without an email is skipped until Travis adds one. */
export async function crewWithAlertsOn(): Promise<Recipient[]> {
  const snap = await db.collection('crew').get();
  return snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as CrewDoc) }))
    .filter((c) => c.alertsOn !== false)
    .map((c): Recipient => ({ id: c.id, role: 'crew', name: c.name, email: c.email || null, phone: c.phone || null }))
    .filter((c) => CHANNELS.some((ch) => ch.canReach(c)));
}

export interface CrewSendResult {
  /** Crew members it went to. */
  sent: number;
  failed: number;
}

/**
 * Sends a message to every crew member with alerts on, one at a time, so
 * one bad address doesn't stop the rest and nobody sees anyone else's
 * address. Never throws for a single failure; check the counts.
 */
export async function notifyCrew(message: Message): Promise<CrewSendResult> {
  const crew = await crewWithAlertsOn();
  const result: CrewSendResult = { sent: 0, failed: 0 };
  for (const member of crew) {
    try {
      await deliver(member, message);
      result.sent++;
    } catch (err) {
      result.failed++;
      logger.error(`${message.type} to crew member ${member.id} failed`, { err });
    }
  }
  logger.info(`${message.type} sent to crew`, { key: message.key, ...result });
  return result;
}

/* -------------------------------------------------------------------------- */
/* Travis                                                                     */
/* -------------------------------------------------------------------------- */

/** Sends a message to Travis (the admin address). Throws if it fails. */
export async function notifyOwner(message: Message): Promise<string | null> {
  return deliver(
    { id: 'owner', role: 'owner', name: 'Travis', email: ADMIN_EMAIL.value(), phone: null },
    message,
  );
}

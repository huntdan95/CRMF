import { logger } from 'firebase-functions/v2';
import type { Firestore, Timestamp } from 'firebase-admin/firestore';
import type { CreateEmailOptions, CreateEmailRequestOptions, CreateEmailResponse } from 'resend';

import { db as defaultDb, FieldValue } from './firebase';
import { getFromAddress, getResend } from './resend';

/**
 * Every email the site sends goes through {@link sendEmail}, which records
 * it in `emailLog/{resendEmailId}`. The Resend webhook (resendWebhook.ts)
 * then follows each one: delivered, delayed, bounced or marked as spam.
 *
 * The log entry's shape is shared with other features (waiver evidence
 * reads `delivered` from it), so keep the field names as they are.
 */

export const EMAIL_LOG = 'emailLog';

/**
 * What an email is. `reschedule` is the updated confirmation after a move;
 * `rescheduleAck` is the customer's "we got your request" note. `admin` is
 * anything to Travis (his copy of a reschedule request, payment alerts,
 * bounce alerts); `contact` is a contact-form message forwarded to him.
 */
export type EmailKind =
  | 'confirmation'
  | 'cancellation'
  | 'closureOffer'
  | 'closureReminder'
  | 'reminder'
  | 'prep'
  | 'directions'
  | 'followup'
  | 'photos'
  | 'reschedule'
  | 'rescheduleAck'
  | 'waiver'
  | 'weatherCancel'
  | 'crew'
  | 'admin'
  | 'contact'
  | (string & {});

/** "booking confirmation", for alerts and admin. */
export const EMAIL_KIND_LABEL: Record<string, string> = {
  confirmation: 'booking confirmation',
  cancellation: 'cancellation email',
  closureOffer: '“pick a new date” email',
  closureReminder: '“still pick a new date” reminder',
  reminder: 'day-before reminder',
  prep: 'trip-prep email',
  directions: 'day-of directions',
  followup: '“thanks for coming” email',
  photos: 'trip photos email',
  reschedule: 'updated confirmation',
  rescheduleAck: '“we got your request” email',
  waiver: 'waiver link',
  weatherCancel: 'weather cancellation email',
};

export function emailKindLabel(kind: string): string {
  return EMAIL_KIND_LABEL[kind] ?? `${kind} email`;
}

/**
 * Emails to the customer who made the booking, at the booking's email
 * address. A bounce of one of these is about that address.
 */
export const LEAD_KINDS: ReadonlySet<string> = new Set([
  'confirmation',
  'cancellation',
  'closureOffer',
  'closureReminder',
  'reminder',
  'prep',
  'directions',
  'followup',
  'photos',
  'reschedule',
  'rescheduleAck',
  'weatherCancel',
]);

/**
 * Emails to Travis, or to crew. Their bounces are logged but never alert
 * Travis: an alert is itself an `admin` email, so a bouncing alert can't
 * set off another.
 */
export const NO_ALERT_KINDS: ReadonlySet<string> = new Set(['admin', 'contact', 'crew']);

export type EmailStatus = 'sent' | 'delivered' | 'delayed' | 'bounced' | 'complained';

export interface EmailLogEvent {
  /** Resend's event type, e.g. `email.bounced`. */
  type: string;
  /** When Resend says it happened. */
  at: Timestamp;
  detail?: string;
}

export interface EmailLogEntry {
  kind: EmailKind;
  bookingId: string | null;
  waiverId: string | null;
  crewId: string | null;
  to: string[];
  subject: string;
  sentAt: Timestamp;
  status: EmailStatus;
  bounceType: string | null;
  bounceMessage: string | null;
  lastEventAt: Timestamp | null;
  /** Appended by the webhook. */
  events: EmailLogEvent[];
}

/** What an email is about, for the log and for Resend's tags. */
export interface EmailRefs {
  bookingId?: string | null;
  waiverId?: string | null;
  crewId?: string | null;
}

export interface SendEmailInput extends EmailRefs {
  kind: EmailKind;
  to: string | string[];
  subject: string;
  html: string;
  text: string;
  /** Defaults to RESEND_FROM_EMAIL. */
  from?: string;
  bcc?: string | string[];
  replyTo?: string | string[];
  headers?: Record<string, string>;
  idempotencyKey?: string;
}

/** Stand-ins for tests; the real Resend client and Firestore otherwise. */
export interface EmailDeps {
  db?: Firestore;
  resend?: {
    emails: {
      send(payload: CreateEmailOptions, options?: CreateEmailRequestOptions): Promise<CreateEmailResponse>;
    };
  };
}

/**
 * Resend refused the email. Resend reports this in `error` rather than
 * throwing; {@link sendEmail} throws it so callers can't miss it. `code` is
 * Resend's error name, e.g. `invalid_idempotent_request`. The message starts
 * "Resend failed", which lib/http.ts passes on to the admin page.
 */
export class EmailSendError extends Error {
  constructor(
    public readonly code: string,
    detail: string,
  ) {
    super(`Resend failed: ${detail}`);
    this.name = 'EmailSendError';
  }
}

export function isEmailSendError(err: unknown, code?: string): err is EmailSendError {
  return err instanceof EmailSendError && (code === undefined || err.code === code);
}

/** Resend allows ASCII letters, digits, `_` and `-` in tag values, up to 256 of them. */
const TAG_VALUE = /^[A-Za-z0-9_-]{1,256}$/;

/**
 * Tags Resend sends back with each webhook event, so an event can be traced
 * to its booking even if the log entry was never written. Values Resend
 * wouldn't accept are left out rather than mangled.
 */
export function emailTags(kind: EmailKind, refs: EmailRefs): Array<{ name: string; value: string }> {
  const tags: Array<{ name: string; value: string }> = [];
  const add = (name: string, value: string | null | undefined) => {
    if (value && TAG_VALUE.test(value)) tags.push({ name, value });
  };
  add('kind', kind);
  add('bookingId', refs.bookingId);
  add('waiverId', refs.waiverId);
  add('crewId', refs.crewId);
  return tags;
}

/**
 * Sends one email through Resend and logs it. Throws {@link EmailSendError}
 * if Resend refuses it. A log write that fails is logged and otherwise
 * ignored: the email went out, and the webhook can rebuild the entry from
 * the tags.
 */
export async function sendEmail(input: SendEmailInput, deps: EmailDeps = {}): Promise<{ id: string | null }> {
  const to = Array.isArray(input.to) ? input.to : [input.to];
  const refs = {
    bookingId: input.bookingId ?? null,
    waiverId: input.waiverId ?? null,
    crewId: input.crewId ?? null,
  };
  const payload: CreateEmailOptions = {
    from: input.from ?? getFromAddress(),
    to,
    subject: input.subject,
    html: input.html,
    text: input.text,
    ...(input.bcc !== undefined && { bcc: input.bcc }),
    ...(input.replyTo !== undefined && { replyTo: input.replyTo }),
    ...(input.headers && { headers: input.headers }),
    tags: emailTags(input.kind, refs),
  };
  const resend = deps.resend ?? getResend();
  const { data, error } = await resend.emails.send(
    payload,
    input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : undefined,
  );
  if (error) throw new EmailSendError(error.name ?? 'unknown', error.message ?? 'unknown');

  const id = data?.id ?? null;
  if (!id) {
    logger.warn('Resend accepted an email without an id; not logged', { kind: input.kind, ...refs });
    return { id: null };
  }
  try {
    await writeSentEntry(deps.db ?? defaultDb, id, { kind: input.kind, ...refs, to, subject: input.subject });
  } catch (err) {
    logger.error('Email sent but not logged', { emailId: id, kind: input.kind, ...refs, err });
  }
  return { id };
}

async function writeSentEntry(
  db: Firestore,
  id: string,
  sent: Pick<EmailLogEntry, 'kind' | 'bookingId' | 'waiverId' | 'crewId' | 'to' | 'subject'>,
): Promise<void> {
  const ref = db.collection(EMAIL_LOG).doc(id);
  try {
    await ref.create({
      ...sent,
      sentAt: FieldValue.serverTimestamp(),
      status: 'sent',
      bounceType: null,
      bounceMessage: null,
      lastEventAt: null,
      events: [],
    });
  } catch (err) {
    if (!alreadyExists(err)) throw err;
    // The webhook got here first and built the entry from the tags: keep
    // its status and events.
    await ref.set({ ...sent, sentAt: FieldValue.serverTimestamp() }, { merge: true });
  }
}

/** Firestore's ALREADY_EXISTS, from `create()`. */
function alreadyExists(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return code === 6 || code === 'already-exists' || code === 'ALREADY_EXISTS';
}

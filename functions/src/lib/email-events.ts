import { logger } from 'firebase-functions/v2';
import type { Firestore } from 'firebase-admin/firestore';
import { Webhook } from 'svix';

import { FieldValue, Timestamp } from './firebase';
import {
  EMAIL_LOG,
  LEAD_KINDS,
  NO_ALERT_KINDS,
  type EmailLogEntry,
  type EmailLogEvent,
  type EmailStatus,
} from './email-log';
import { hoursUntilTour } from './datetime';
import { SLOT_START_TIMES } from './schedule';
import type { Booking, EmailBounce } from './types';

/**
 * What the Resend webhook (resendWebhook.ts) does with each event: checks
 * the Svix signature, handles each delivery once, updates the email's log
 * entry, and tells Travis when a customer may not have an email he needs
 * them to have.
 *
 * Payload fields are from Resend's docs (resend.com/docs/webhooks/emails/
 * bounced): `type`, `created_at`, and `data.email_id`, `data.to`,
 * `data.subject`, `data.tags` (an object of name → value), and on a bounce
 * `data.bounce.type` ("Permanent", "Transient" or "Undetermined"; the docs
 * also show "Temporary"), `data.bounce.subType` and `data.bounce.message`.
 */

export const HANDLED_EVENTS = [
  'email.delivered',
  'email.bounced',
  'email.delivery_delayed',
  'email.complained',
] as const;
export type HandledEvent = (typeof HANDLED_EVENTS)[number];

export function isHandledEvent(type: unknown): type is HandledEvent {
  return (HANDLED_EVENTS as readonly unknown[]).includes(type);
}

/** Svix delivery ids, used as the dedupe document id. */
export const WEBHOOK_EVENTS = 'resendWebhookEvents';

export interface ResendBounce {
  type?: string;
  subType?: string;
  message?: string;
}

export interface ResendEvent {
  type: string;
  created_at?: string;
  data?: {
    email_id?: string;
    created_at?: string;
    to?: string[] | string;
    subject?: string;
    tags?: Record<string, string> | Array<{ name: string; value: string }>;
    bounce?: ResendBounce;
  };
}

/* -------------------------------------------------------------------------- */
/* Status                                                                     */
/* -------------------------------------------------------------------------- */

const STATUS_FOR: Record<HandledEvent, EmailStatus> = {
  'email.delivered': 'delivered',
  'email.bounced': 'bounced',
  'email.delivery_delayed': 'delayed',
  'email.complained': 'complained',
};

/**
 * Events can arrive out of order (a retried `delivered` after a `bounced`).
 * Later in this list wins, so the status never moves back: a delay is
 * overtaken by delivery, delivery by a bounce, and a spam complaint (which
 * means it was delivered) beats everything.
 */
const STATUS_RANK: Record<EmailStatus, number> = {
  sent: 0,
  delayed: 1,
  delivered: 2,
  bounced: 3,
  complained: 4,
};

export function laterStatus(current: EmailStatus, incoming: EmailStatus): EmailStatus {
  return (STATUS_RANK[incoming] ?? 0) > (STATUS_RANK[current] ?? 0) ? incoming : current;
}

/** Resend's `bounce.type` for a hard bounce; anything else is treated as temporary. */
export function isPermanentBounce(bounceType: string | null | undefined): boolean {
  return (bounceType ?? '').trim().toLowerCase() === 'permanent';
}

/* -------------------------------------------------------------------------- */
/* Alert rules                                                                */
/* -------------------------------------------------------------------------- */

export type AlertReason = 'permanent' | 'temporary' | 'delayed';

/** A temporary bounce alerts Travis only this close to the trip. */
export const TEMPORARY_BOUNCE_ALERT_HOURS = 48;
/** A delivery delay alerts Travis only this close to the trip. */
export const DELAY_ALERT_HOURS = 24;

/**
 * Whether to tell Travis. A permanent bounce always; a temporary one only
 * if the trip leaves within 48 hours, and a delay only within 24, since
 * further out Resend's retries usually get it there. Spam complaints and
 * deliveries never alert. `hoursUntilTrip` is from now to departure, marina
 * time; null when it can't be worked out.
 */
export function alertReason(
  type: HandledEvent,
  bounceType: string | null | undefined,
  hoursUntilTrip: number | null,
): AlertReason | null {
  const soon = (limit: number) => hoursUntilTrip !== null && hoursUntilTrip >= 0 && hoursUntilTrip <= limit;
  if (type === 'email.bounced') {
    if (isPermanentBounce(bounceType)) return 'permanent';
    return soon(TEMPORARY_BOUNCE_ALERT_HOURS) ? 'temporary' : null;
  }
  if (type === 'email.delivery_delayed') return soon(DELAY_ALERT_HOURS) ? 'delayed' : null;
  return null;
}

/** Hours from `now` to the booking's departure, or null for an unknown slot. */
export function hoursUntilTrip(b: Pick<Booking, 'date' | 'timeSlot'>, now: Date): number | null {
  const start = SLOT_START_TIMES[b.timeSlot];
  if (!start || !/^\d{4}-\d{2}-\d{2}$/.test(b.date ?? '')) return null;
  return hoursUntilTour(b.date, start, now);
}

/* -------------------------------------------------------------------------- */
/* Signature                                                                  */
/* -------------------------------------------------------------------------- */

export type VerifyResult =
  | { ok: true; id: string; event: ResendEvent }
  | { ok: false; status: 400 | 401 | 500; error: string };

type Headers = Record<string, string | string[] | undefined>;

function header(headers: Headers, name: string): string | null {
  const v = headers[name] ?? headers[name.toLowerCase()];
  return typeof v === 'string' && v ? v : null;
}

/** Firestore document ids we accept from outside. */
const DOC_ID = /^[A-Za-z0-9_-]{1,200}$/;

/**
 * Checks the Svix signature on the raw request body, as Resend documents.
 * Nothing unsigned or wrongly signed gets past this, and the body is only
 * parsed once it's verified. Svix also refuses timestamps more than five
 * minutes off, so an old delivery can't be replayed.
 */
export function verifyResendWebhook(
  rawBody: Buffer | string | undefined,
  headers: Headers,
  secret: string | undefined,
): VerifyResult {
  const id = header(headers, 'svix-id');
  const timestamp = header(headers, 'svix-timestamp');
  const signature = header(headers, 'svix-signature');
  if (!id || !timestamp || !signature) return { ok: false, status: 400, error: 'Missing signature headers' };
  if (rawBody === undefined || rawBody.length === 0) return { ok: false, status: 400, error: 'Missing body' };
  if (!secret) return { ok: false, status: 500, error: 'Webhook secret not set' };

  let wh: Webhook;
  try {
    wh = new Webhook(secret);
  } catch {
    return { ok: false, status: 500, error: 'Webhook secret is not a valid signing secret' };
  }
  let payload: unknown;
  try {
    const body = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
    payload = wh.verify(body, { 'svix-id': id, 'svix-timestamp': timestamp, 'svix-signature': signature });
  } catch {
    return { ok: false, status: 401, error: 'Invalid signature' };
  }
  if (!DOC_ID.test(id)) return { ok: false, status: 400, error: 'Bad svix-id' };
  if (!payload || typeof payload !== 'object' || typeof (payload as ResendEvent).type !== 'string') {
    return { ok: false, status: 400, error: 'Not a Resend event' };
  }
  return { ok: true, id, event: payload as ResendEvent };
}

/* -------------------------------------------------------------------------- */
/* Handling one delivery                                                      */
/* -------------------------------------------------------------------------- */

/** One alert to Travis about a customer's email; see lib/bounce-alert.ts. */
export interface BounceAlert {
  reason: AlertReason;
  booking: Booking;
  kind: string;
  emailId: string;
  /** The address that failed. */
  address: string;
  subject: string;
  bounceType: string | null;
  bounceMessage: string | null;
}

export interface WebhookDeps {
  db: Firestore;
  secret: string | undefined;
  now?: () => Date;
  sendAlert: (alert: BounceAlert) => Promise<void>;
}

export interface WebhookAnswer {
  status: number;
  body: Record<string, unknown>;
}

/** Another delivery of the same alert is being sent right now; try again later. */
class AlertInFlight extends Error {}

/** Past this, a claim (on a delivery or an alert) is taken to have crashed. */
const CLAIM_TIMEOUT_MS = 5 * 60_000;

/**
 * The whole webhook, minus HTTP. Each Svix delivery id is claimed in
 * `resendWebhookEvents/{svix-id}` and marked done once handled, so Svix's
 * retries are no-ops. If handling fails the claim is let go and Svix gets a
 * 500, so it delivers again; every step is safe to re-run.
 */
export async function handleResendWebhook(
  req: { rawBody: Buffer | string | undefined; headers: Headers },
  deps: WebhookDeps,
): Promise<WebhookAnswer> {
  const verified = verifyResendWebhook(req.rawBody, req.headers, deps.secret);
  if (!verified.ok) {
    if (verified.status === 500) logger.error(`Resend webhook not set up: ${verified.error}`);
    else logger.warn(`Resend webhook refused: ${verified.error}`);
    return { status: verified.status, body: { error: verified.error } };
  }
  const { id, event } = verified;
  if (!isHandledEvent(event.type)) {
    return { status: 200, body: { received: true, ignored: event.type } };
  }

  const now = deps.now ?? (() => new Date());
  const claimRef = deps.db.collection(WEBHOOK_EVENTS).doc(id);
  const claim = await deps.db.runTransaction(async (tx) => {
    const prior = (await tx.get(claimRef)).data() as { status?: string; claimedAtMs?: number } | undefined;
    if (prior) {
      if (prior.status !== 'processing') return 'duplicate' as const;
      if (now().getTime() - (prior.claimedAtMs ?? 0) < CLAIM_TIMEOUT_MS) return 'in-flight' as const;
    }
    tx.set(claimRef, {
      id,
      type: event.type,
      emailId: event.data?.email_id ?? null,
      status: 'processing',
      claimedAtMs: now().getTime(),
      receivedAt: FieldValue.serverTimestamp(),
    });
    return 'claimed' as const;
  });
  if (claim === 'duplicate') return { status: 200, body: { received: true, duplicate: true } };
  // Not 2xx, so Svix tries again later and finds it done.
  if (claim === 'in-flight') return { status: 409, body: { received: true, inFlight: true } };

  try {
    const outcome = await processResendEvent(event, { ...deps, now });
    logger.info('Resend event', { svixId: id, type: event.type, emailId: event.data?.email_id, ...outcome });
  } catch (err) {
    logger.error('Resend webhook handler failed', { svixId: id, type: event.type, err });
    await claimRef.delete().catch((deleteErr) => logger.error(`Could not release claim on ${id}`, { deleteErr }));
    return { status: 500, body: { received: false } };
  }
  await claimRef
    .update({ status: 'done', processedAt: FieldValue.serverTimestamp() })
    .catch((err) => logger.warn(`Could not mark ${id} done`, { err }));
  return { status: 200, body: { received: true } };
}

export interface ProcessOutcome {
  logged: boolean;
  bookingId?: string | null;
  kind?: string;
  status?: EmailStatus;
  bounceRecorded?: boolean;
  suppressed?: boolean;
  alert?: AlertReason | null;
  alertSent?: 'sent' | 'already-sent' | null;
}

/** Updates the log entry, then the booking. Safe to run twice for the same event. */
export async function processResendEvent(
  event: ResendEvent,
  deps: Omit<WebhookDeps, 'secret'> & { now: () => Date },
): Promise<ProcessOutcome> {
  const type = event.type as HandledEvent;
  const data = event.data ?? {};
  const emailId = data.email_id;
  if (!emailId || !DOC_ID.test(emailId)) {
    logger.warn('Resend event without a usable email_id', { type });
    return { logged: false };
  }
  const now = deps.now();
  const at = toTimestamp(event.created_at) ?? Timestamp.fromDate(now);
  const bounce = type === 'email.bounced' ? (data.bounce ?? {}) : null;
  const bounceType = bounce?.type ? String(bounce.type).slice(0, 100) : null;
  const bounceMessage = bounce?.message ? String(bounce.message).slice(0, 1000) : null;
  const detail = bounce
    ? [bounceType, bounce.subType ? `(${String(bounce.subType).slice(0, 100)})` : null].filter(Boolean).join(' ') +
      (bounceMessage ? `: ${bounceMessage}` : '')
    : '';
  const logEvent: EmailLogEvent = { type, at, ...(detail && { detail }) };

  const entry = await recordOnLog(deps.db, emailId, event, logEvent, bounce ? { bounceType, bounceMessage } : null);
  const outcome: ProcessOutcome = { logged: true, bookingId: entry.bookingId, kind: entry.kind, status: entry.status };

  // Travis's own emails, and crew's, never alert: an alert is itself an
  // `admin` email, so one that bounces can't set off another.
  if (!entry.bookingId || !DOC_ID.test(entry.bookingId) || NO_ALERT_KINDS.has(entry.kind)) return outcome;
  if (type === 'email.delivered') return outcome;

  const bookingRef = deps.db.collection('bookings').doc(entry.bookingId);
  if (type === 'email.complained') {
    outcome.suppressed = await deps.db.runTransaction(async (tx) => {
      const snap = await tx.get(bookingRef);
      if (!snap.exists) return false;
      if (!(snap.data() as Booking).marketingSuppressed) {
        tx.update(bookingRef, { marketingSuppressed: true, updatedAt: FieldValue.serverTimestamp() });
      }
      return true;
    });
    return outcome;
  }

  const kind = entry.kind;
  if (!SAFE_KIND.test(kind)) {
    logger.warn('Email kind not usable as a field name; not flagged on the booking', { kind, emailId });
    return outcome;
  }
  const addresses = recipients(data.to);
  const failed = addresses.length ? addresses : entry.to;
  // Emails to the customer who booked go to the booking's address: a bounce
  // is flagged on the booking, for "Fix email and resend". Others about the
  // booking (a guest's waiver link, later) only alert.
  const lead = LEAD_KINDS.has(kind);

  // Checked against the booking in a transaction: if Travis has since
  // changed the address, the event is about one that's gone, and there's
  // nothing to flag or call about.
  const checked = await deps.db.runTransaction(async (tx) => {
    const snap = await tx.get(bookingRef);
    if (!snap.exists) return null;
    const b = { ...(snap.data() as Booking), id: entry.bookingId! };
    const address = lead ? failed.find((a) => sameAddress(a, b.customerEmail)) : failed[0];
    if (lead && !address) return { booking: b, address: null };
    if (lead && type === 'email.bounced') {
      const record: EmailBounce = {
        emailId,
        to: address!,
        subject: entry.subject ?? '',
        bounceType,
        bounceMessage,
        at,
      };
      tx.update(bookingRef, { [`emailBounces.${kind}`]: record, updatedAt: FieldValue.serverTimestamp() });
    }
    return { booking: b, address: address ?? b.customerEmail };
  });
  if (!checked) return outcome;
  if (!checked.address) {
    logger.info('Email event for an address the booking no longer uses', { emailId, bookingId: entry.bookingId, kind });
    return outcome;
  }
  outcome.bounceRecorded = lead && type === 'email.bounced';

  const reason = alertReason(type, bounceType, hoursUntilTrip(checked.booking, now));
  outcome.alert = reason;
  if (!reason) return outcome;

  const alert: BounceAlert = {
    reason,
    booking: checked.booking,
    kind,
    emailId,
    address: checked.address,
    subject: entry.subject ?? '',
    bounceType,
    bounceMessage,
  };
  outcome.alertSent = await alertOnce(deps.db, bookingRef, kind, now, () => deps.sendAlert(alert));
  return outcome;
}

/** Kinds become field names (`bounceAlertSentAt.<kind>`), so only plain ones. */
const SAFE_KIND = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

/**
 * Sends at most one alert per booking per kind. `bounceAlertSentAt.<kind>`
 * is the marker; `bounceAlertClaims.<kind>` holds it while the email goes
 * out, set in a transaction so two deliveries can't both send. A send that
 * fails lets go of the claim and throws, so the webhook is retried. If the
 * function dies after sending but before the marker, the claim times out
 * and a retry sends again under the same Resend idempotency key, which
 * Resend answers without sending a second email.
 */
async function alertOnce(
  db: Firestore,
  bookingRef: FirebaseFirestore.DocumentReference,
  kind: string,
  now: Date,
  send: () => Promise<void>,
): Promise<'sent' | 'already-sent'> {
  const claimed = await db.runTransaction(async (tx) => {
    const b = (await tx.get(bookingRef)).data() as Booking | undefined;
    if (!b) return false;
    if (b.bounceAlertSentAt?.[kind]) return false;
    const claimedAt = b.bounceAlertClaims?.[kind];
    if (typeof claimedAt === 'number' && now.getTime() - claimedAt < CLAIM_TIMEOUT_MS) throw new AlertInFlight(kind);
    tx.update(bookingRef, { [`bounceAlertClaims.${kind}`]: now.getTime() });
    return true;
  });
  if (!claimed) return 'already-sent';
  try {
    await send();
  } catch (err) {
    await bookingRef
      .update({ [`bounceAlertClaims.${kind}`]: FieldValue.delete() })
      .catch((e) => logger.error('Could not release bounce-alert claim', { bookingId: bookingRef.id, kind, e }));
    throw err;
  }
  await bookingRef.update({
    [`bounceAlertSentAt.${kind}`]: FieldValue.serverTimestamp(),
    [`bounceAlertClaims.${kind}`]: FieldValue.delete(),
  });
  return 'sent';
}

/**
 * Adds the event to `emailLog/{emailId}`, creating the entry from the
 * event's tags if the send never got logged. Adding the same event twice
 * (same type and time) does nothing, so a retried delivery doesn't list it
 * twice.
 */
async function recordOnLog(
  db: Firestore,
  emailId: string,
  event: ResendEvent,
  logEvent: EmailLogEvent,
  bounce: { bounceType: string | null; bounceMessage: string | null } | null,
): Promise<EmailLogEntry> {
  const ref = db.collection(EMAIL_LOG).doc(emailId);
  const status = STATUS_FOR[event.type as HandledEvent];
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const prev = snap.exists ? (snap.data() as EmailLogEntry) : null;
    if (prev) {
      const events = Array.isArray(prev.events) ? prev.events : [];
      const seen = events.some((e) => e.type === logEvent.type && millis(e.at) === logEvent.at.toMillis());
      const nextStatus = laterStatus(prev.status ?? 'sent', status);
      const last = millis(prev.lastEventAt);
      // A hard bounce stays the reason shown, even if a softer one lands after it.
      const keepBounce = !!bounce && isPermanentBounce(prev.bounceType) && !isPermanentBounce(bounce.bounceType);
      const update = {
        status: nextStatus,
        events: seen ? events : [...events, logEvent],
        lastEventAt: last !== null && last > logEvent.at.toMillis() ? prev.lastEventAt : logEvent.at,
        ...(bounce && !keepBounce ? bounce : {}),
      };
      tx.update(ref, update);
      return { ...prev, ...update };
    }
    const tags = tagMap(event.data?.tags);
    const entry: EmailLogEntry = {
      kind: tags.kind ?? 'unknown',
      bookingId: tags.bookingId ?? null,
      waiverId: tags.waiverId ?? null,
      crewId: tags.crewId ?? null,
      to: recipients(event.data?.to),
      subject: typeof event.data?.subject === 'string' ? event.data.subject.slice(0, 500) : '',
      // When Resend took the email; the send's own log write never landed.
      sentAt: toTimestamp(event.data?.created_at) ?? logEvent.at,
      status,
      bounceType: bounce?.bounceType ?? null,
      bounceMessage: bounce?.bounceMessage ?? null,
      lastEventAt: logEvent.at,
      events: [logEvent],
    };
    tx.set(ref, entry);
    return entry;
  });
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function toTimestamp(iso: unknown): Timestamp | null {
  if (typeof iso !== 'string') return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? Timestamp.fromMillis(ms) : null;
}

function millis(ts: unknown): number | null {
  if (ts && typeof ts === 'object' && typeof (ts as { toMillis?: () => number }).toMillis === 'function') {
    return (ts as { toMillis: () => number }).toMillis();
  }
  return null;
}

function recipients(to: unknown): string[] {
  const list = Array.isArray(to) ? to : typeof to === 'string' ? [to] : [];
  return list.filter((a): a is string => typeof a === 'string' && a.length > 0).map((a) => a.slice(0, 320));
}

/** Resend documents tags as an object; accept a list of { name, value } as well. */
function tagMap(tags: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (Array.isArray(tags)) {
    for (const t of tags) {
      if (t && typeof t.name === 'string' && typeof t.value === 'string') out[t.name] = t.value;
    }
  } else if (tags && typeof tags === 'object') {
    for (const [k, v] of Object.entries(tags)) if (typeof v === 'string') out[k] = v;
  }
  return out;
}

export function sameAddress(a: string | null | undefined, b: string | null | undefined): boolean {
  return !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();
}

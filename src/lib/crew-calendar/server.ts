import 'server-only';
import { randomBytes } from 'node:crypto';
import { FieldValue, type DocumentReference, type Firestore } from 'firebase-admin/firestore';
import { adminDb } from '../firebase/admin';
import { marinaNow } from '../availability';
import { sha256 } from '../crew-server';
import { hostFromHeaders } from '../host';
import {
  BOOKING_FIELDS,
  buildFeed,
  feedWindow,
  nextRecord,
  planDepartures,
  removedRecord,
  renderEvent,
  toFeedBlackout,
  toFeedBooking,
  type DepartureRecord,
  type RenderedEvent,
} from './feed';

/*
 * Crew calendar links. Each crew member has at most one live link:
 *
 *   crewCalendarTokens/{sha256(token)}  { crewId, createdAt, createdBy }
 *   crewCalendars/{crewId}              { tokenHash, issuedAt, issuedBy, issuedVia }
 *   crewCalendarDepartures/{date_slot}  fingerprint + SEQUENCE per event
 *
 * All three are server-only (firestore.rules). Only the token's hash is
 * stored; the token itself is in the link and nowhere else. A link works
 * while its token doc exists, the crew member does, and crewCalendars
 * still points at it. Issuing a new link, resetting the password or
 * removing the crew member deletes the old token docs.
 *
 * The admin side (functions/src/adminCrewCalendar.ts) issues links the
 * same way and emails them. Keep the two in step.
 */

export const TOKENS = 'crewCalendarTokens';
export const CALENDARS = 'crewCalendars';
export const DEPARTURES = 'crewCalendarDepartures';

/** 32 random bytes, base64url: 43 characters. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function isWellFormedToken(token: string): boolean {
  return TOKEN_PATTERN.test(token);
}

/** The crew member a feed token belongs to, or null if it isn't a live link. */
export async function crewIdForToken(token: string, db: Firestore = adminDb()): Promise<string | null> {
  if (!isWellFormedToken(token)) return null;
  const hash = sha256(token);
  const tokenSnap = await db.collection(TOKENS).doc(hash).get();
  const crewId = tokenSnap.get('crewId');
  if (!tokenSnap.exists || typeof crewId !== 'string') return null;
  const [member, calendar] = await db.getAll(db.collection('crew').doc(crewId), db.collection(CALENDARS).doc(crewId));
  if (!member.exists || calendar.get('tokenHash') !== hash) return null;
  return crewId;
}

/** When the crew member's live calendar link was made, or null if they have none. */
export async function calendarLinkIssuedAt(crewId: string): Promise<Date | null> {
  const snap = await adminDb().collection(CALENDARS).doc(crewId).get();
  if (typeof snap.get('tokenHash') !== 'string') return null;
  const at = snap.get('issuedAt') as { toDate?: () => Date } | undefined;
  return at?.toDate?.() ?? new Date(0);
}

/**
 * The site's origin as the caller reached it (production, the staging
 * host, or localhost in development), for links back to it.
 */
export function requestOrigin(req: Request): string {
  const host = hostFromHeaders(req.headers);
  if (!host) return new URL(req.url).origin;
  const local = host === 'localhost' || host === '127.0.0.1';
  const port = local ? new URL(req.url).port : '';
  return `${local ? 'http' : 'https'}://${host}${port ? `:${port}` : ''}`;
}

/**
 * A new link for a crew member, signed in on the crew app. Their old link
 * stops working. Returns the token, which is shown to them once and not
 * stored.
 */
export async function issueCalendarToken(member: { id: string; name: string; email: string | null }): Promise<string> {
  const db = adminDb();
  const token = randomBytes(32).toString('base64url');
  const hash = sha256(token);
  const crewRef = db.collection('crew').doc(member.id);
  const replaced = await db.runTransaction(async (tx) => {
    const [crew, old] = await Promise.all([
      tx.get(crewRef),
      tx.get(db.collection(TOKENS).where('crewId', '==', member.id)),
    ]);
    if (!crew.exists) throw new Error('Not on the crew');
    old.docs.forEach((d) => tx.delete(d.ref));
    tx.set(db.collection(TOKENS).doc(hash), {
      crewId: member.id,
      createdAt: FieldValue.serverTimestamp(),
      createdBy: member.email,
    });
    tx.set(db.collection(CALENDARS).doc(member.id), {
      tokenHash: hash,
      issuedAt: FieldValue.serverTimestamp(),
      issuedBy: member.email,
      issuedVia: 'crew',
    });
    tx.update(crewRef, { calendarLinkIssuedAt: FieldValue.serverTimestamp() });
    return old.size;
  });
  // The token never goes in the log, nor its hash.
  await db.collection('auditLog').add({
    action: 'crew.calendar',
    actorEmail: member.email,
    targetId: member.id,
    payload: { name: member.name, email: member.email, by: 'crew', replacedLinks: replaced },
    createdAt: FieldValue.serverTimestamp(),
  });
  return token;
}

/** `https://host/api/crew-calendar/<token>` and the same with `webcal://`. */
export function feedUrls(origin: string, token: string): { httpsUrl: string; webcalUrl: string } {
  const httpsUrl = `${origin.replace(/\/$/, '')}/api/crew-calendar/${token}`;
  return { httpsUrl, webcalUrl: httpsUrl.replace(/^https?:\/\//, 'webcal://') };
}

/* -------------------------------------------------------------------------- */
/* The feed                                                                   */
/* -------------------------------------------------------------------------- */

/** Firestore allows 500 writes per transaction; stay well under. */
const RECORDS_PER_TRANSACTION = 200;

type Change = { id: string; ref: DocumentReference; event: RenderedEvent | null };

/**
 * Saves new fingerprints and SEQUENCEs for the departures whose events
 * changed (or dropped out), and returns every departure's current record.
 * Each batch re-reads its records in a transaction, so two phones fetching
 * at once bump a changed event once, and SEQUENCE only ever goes up.
 */
async function syncRecords(
  db: Firestore,
  events: RenderedEvent[],
  records: Map<string, DepartureRecord>,
  nowMs: number,
): Promise<Map<string, DepartureRecord>> {
  const changes: Change[] = [];
  const ref = (id: string) => db.collection(DEPARTURES).doc(id);
  const shown = new Set(events.map((e) => e.id));
  for (const event of events) {
    if (nextRecord(records.get(event.id), event, nowMs)) changes.push({ id: event.id, ref: ref(event.id), event });
  }
  for (const [id, record] of records) {
    if (!shown.has(id) && removedRecord(record, nowMs)) changes.push({ id, ref: ref(id), event: null });
  }

  const current = new Map(records);
  for (let i = 0; i < changes.length; i += RECORDS_PER_TRANSACTION) {
    const batch = changes.slice(i, i + RECORDS_PER_TRANSACTION);
    const saved = await db.runTransaction(async (tx) => {
      const snaps = await tx.getAll(...batch.map((c) => c.ref));
      const out: Array<[string, DepartureRecord]> = [];
      batch.forEach((change, j) => {
        const fresh = snaps[j]!.exists ? (snaps[j]!.data() as DepartureRecord) : undefined;
        if (change.event) {
          const next = nextRecord(fresh, change.event, nowMs);
          if (next) tx.set(change.ref, next);
          out.push([change.id, next ?? fresh!]);
        } else if (fresh) {
          const next = removedRecord(fresh, nowMs);
          if (next) tx.set(change.ref, next);
          out.push([change.id, next ?? fresh]);
        }
      });
      return out;
    });
    for (const [id, record] of saved) current.set(id, record);
  }
  return current;
}

/**
 * The .ics for the last 14 days and the next 120 (marina dates). `origin`
 * is the host the feed was fetched on, for the crew-app link.
 */
export async function buildCrewFeed(origin: string, now: Date = new Date()): Promise<string> {
  const db = adminDb();
  const { from, to } = feedWindow(marinaNow(now).date);
  const inWindow = (name: string) => db.collection(name).where('date', '>=', from).where('date', '<=', to);
  const [bookingsSnap, blackoutsSnap, recordsSnap] = await Promise.all([
    inWindow('bookings').select(...BOOKING_FIELDS).get(),
    inWindow('blackouts').get(),
    inWindow(DEPARTURES).get(),
  ]);

  const records = new Map(recordsSnap.docs.map((d) => [d.id, d.data() as DepartureRecord]));
  const plans = planDepartures({
    bookings: bookingsSnap.docs.map((d) => toFeedBooking(d.id, d.data())),
    blackouts: blackoutsSnap.docs.map((d) => toFeedBlackout(d.id, d.data())),
    records,
    from,
    to,
  });
  const appUrl = `${origin.replace(/\/$/, '')}/crew`;
  const events = plans.map((plan) => renderEvent(plan, { appUrl }));
  const current = await syncRecords(db, events, records, now.getTime());
  return buildFeed(events.map((event) => ({ event, record: current.get(event.id)! })));
}

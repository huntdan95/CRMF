import { createHash, randomBytes } from 'node:crypto';
import type { DocumentReference, Firestore } from 'firebase-admin/firestore';

import { db as defaultDb, FieldValue } from './firebase';

/*
 * Crew calendar links: a subscription URL that puts every booked departure
 * in a crew member's phone calendar. The feed itself is served by the Next
 * app (src/app/api/crew-calendar/[token]/route.ts, built in
 * src/lib/crew-calendar/). Each crew member has at most one live link:
 *
 *   crewCalendarTokens/{sha256(token)}  { crewId, createdAt, createdBy }
 *   crewCalendars/{crewId}              { tokenHash, issuedAt, issuedBy, issuedVia }
 *
 * Both server-only (firestore.rules). Only the hash is stored; the token
 * is in the emailed link and nowhere else, never in logs or the audit log.
 * A link works while its token doc exists, the crew member does, and
 * crewCalendars points at it. `crew/{crewId}.calendarLinkIssuedAt` lets the
 * admin page show who has one. Keep in step with
 * src/lib/crew-calendar/server.ts, which issues links from the crew app.
 */

export const TOKENS = 'crewCalendarTokens';
export const CALENDARS = 'crewCalendars';

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** 32 random bytes, base64url (43 characters). */
export function newCalendarToken(): string {
  return randomBytes(32).toString('base64url');
}

/** `https://…/api/crew-calendar/<token>` and the same with `webcal://`. */
export function calendarUrls(baseUrl: string, token: string): { httpsUrl: string; webcalUrl: string } {
  const httpsUrl = `${baseUrl.replace(/\/$/, '')}/api/crew-calendar/${token}`;
  return { httpsUrl, webcalUrl: httpsUrl.replace(/^https?:\/\//, 'webcal://') };
}

/**
 * Every doc that keeps a crew member's calendar link alive, for removing
 * them or resetting their password: delete these and the link 404s.
 */
export async function calendarLinkDocs(crewId: string, deps: { db?: Firestore } = {}): Promise<DocumentReference[]> {
  const db = deps.db ?? defaultDb;
  const tokens = await db.collection(TOKENS).where('crewId', '==', crewId).get();
  return [...tokens.docs.map((d) => d.ref), db.collection(CALENDARS).doc(crewId)];
}

export interface CalendarLinkMessage {
  to: string;
  name: string;
  httpsUrl: string;
  webcalUrl: string;
}

export type SendLinkOutcome =
  | { kind: 'sent'; name: string; email: string; replacedLinks: number }
  | { kind: 'not-found' }
  /** The email didn't go; the old link (if any) still works. */
  | { kind: 'email-failed'; name: string; email: string; error: string }
  /** Removed from the crew while we were sending: the new link was never switched on. */
  | { kind: 'removed-meanwhile' };

/**
 * Makes a crew member a new calendar link and emails it to them. The new
 * link only goes live once the email has gone, and that same step kills
 * the old one, so a failed send leaves their current calendar working.
 */
export async function sendCrewCalendarLink(
  input: { crewId: string; adminEmail: string },
  deps: {
    db?: Firestore;
    baseUrl: string;
    send: (msg: CalendarLinkMessage) => Promise<void>;
  },
): Promise<SendLinkOutcome> {
  const db = deps.db ?? defaultDb;
  const crewRef = db.collection('crew').doc(input.crewId);
  const member = await crewRef.get();
  if (!member.exists) return { kind: 'not-found' };
  const name = String(member.get('name') ?? '');
  const email = String(member.get('email') ?? '');

  const token = newCalendarToken();
  const hash = sha256Hex(token);
  const tokenRef = db.collection(TOKENS).doc(hash);
  // Not live yet: crewCalendars still points at the old hash.
  await tokenRef.set({ crewId: input.crewId, createdAt: FieldValue.serverTimestamp(), createdBy: input.adminEmail });

  try {
    await deps.send({ to: email, name, ...calendarUrls(deps.baseUrl, token) });
  } catch (err) {
    await tokenRef.delete();
    return { kind: 'email-failed', name, email, error: err instanceof Error ? err.message : 'unknown' };
  }

  const replaced = await db.runTransaction(async (tx) => {
    const [crew, tokens] = await Promise.all([
      tx.get(crewRef),
      tx.get(db.collection(TOKENS).where('crewId', '==', input.crewId)),
    ]);
    const old = tokens.docs.filter((d) => d.id !== hash);
    if (!crew.exists) {
      tokens.docs.forEach((d) => tx.delete(d.ref));
      return null;
    }
    old.forEach((d) => tx.delete(d.ref));
    tx.set(db.collection(CALENDARS).doc(input.crewId), {
      tokenHash: hash,
      issuedAt: FieldValue.serverTimestamp(),
      issuedBy: input.adminEmail,
      issuedVia: 'admin',
    });
    tx.update(crewRef, { calendarLinkIssuedAt: FieldValue.serverTimestamp() });
    return old.length;
  });
  if (replaced === null) return { kind: 'removed-meanwhile' };
  return { kind: 'sent', name, email, replacedLinks: replaced };
}

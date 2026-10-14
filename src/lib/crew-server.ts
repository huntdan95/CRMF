import 'server-only';
import {
  createHash,
  randomBytes,
  scrypt,
  timingSafeEqual,
  type ScryptOptions,
} from 'node:crypto';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { adminDb } from './firebase/admin';
import type { TourTimeSlot, TourType } from './firebase/types';

/*
 * Crew sign-in: Travis's swim guides and mates, added in /admin/crew with
 * an email and password. A crew session is an opaque random token in an
 * httpOnly cookie; Firestore keeps only its SHA-256 (`crewSessions/{hash}`),
 * so removing someone in admin (which deletes those docs) signs them out
 * immediately. Crew never get a Firebase Auth identity, so no Firestore
 * rule can accidentally open data to them — everything they see is read
 * here with the Admin SDK.
 */

export const CREW_SESSION_COOKIE = 'crmf_crew_session';
/**
 * A year: crew add the app to their home screen once and shouldn't be
 * asked again. On iOS the home-screen app has its own cookie jar, separate
 * from Safari, so signing in there is what counts.
 */
export const CREW_SESSION_MAX_AGE_S = 60 * 60 * 24 * 365;

/** Wrong passwords allowed before the account locks for {@link LOCKOUT_MS}. */
const MAX_FAILED_ATTEMPTS = 10;
const LOCKOUT_MS = 15 * 60 * 1000;

export interface CrewMember {
  id: string;
  name: string;
  email: string;
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * The signed-in crew member, or `null` (no cookie, unknown or expired
 * session, removed from the crew, Firestore unreachable).
 */
export async function getCrewMember(): Promise<CrewMember | null> {
  const token = (await cookies()).get(CREW_SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const db = adminDb();
    const session = await db.collection('crewSessions').doc(sha256(token)).get();
    if (!session.exists) return null;
    const { crewId, expiresAt } = session.data() as {
      crewId: string;
      expiresAt: Timestamp;
    };
    if (expiresAt.toMillis() <= Date.now()) return null;
    const member = await db.collection('crew').doc(crewId).get();
    if (!member.exists) return null;
    const { name, email } = member.data() as { name: string; email: string };
    return { id: member.id, name, email };
  } catch {
    return null;
  }
}

/** Server-side guard for crew pages. */
export async function requireCrew(): Promise<CrewMember> {
  const member = await getCrewMember();
  if (!member) redirect('/crew/login');
  return member;
}

/* -------------------------------------------------------------------------- */
/* Sign-in                                                                    */
/* -------------------------------------------------------------------------- */

export type CrewSignInResult =
  | { ok: true; token: string }
  | { ok: false; status: number; error: string };

/**
 * The one answer for every failed sign-in: unknown email, wrong password,
 * or a locked account. A separate "locked" answer would tell a stranger
 * which emails are on the crew, so the lockout is only mentioned here.
 */
const WRONG: CrewSignInResult = {
  ok: false,
  status: 401,
  error:
    'That email and password don’t match. Check the text from Travis, or ask Travis to reset it. Too many wrong tries pauses sign-in for 15 minutes.',
};

/**
 * Checked against unknown emails and locked accounts so they take as long
 * to reject as a wrong password. Never matches anything.
 */
const DUMMY_HASH = `scrypt:16384:8:1:${'A'.repeat(22)}:${'A'.repeat(86)}`;

export async function signInCrew(
  email: string,
  password: string,
  userAgent: string | null,
): Promise<CrewSignInResult> {
  const db = adminDb();
  const found = await db
    .collection('crew')
    .where('email', '==', email.trim().toLowerCase())
    .limit(1)
    .get();
  const member = found.docs[0];
  if (!member) {
    await verifyPassword(password, DUMMY_HASH);
    return WRONG;
  }

  // Each try is counted *before* the password is checked, inside a
  // transaction, so a burst of parallel guesses can't all slip in under
  // the limit.
  const credRef = db.collection('crewCredentials').doc(member.id);
  const gate = await db.runTransaction(async (tx) => {
    const snap = await tx.get(credRef);
    if (!snap.exists) return null;
    const cred = snap.data() as {
      passwordHash: string;
      failedAttempts?: number;
      lockedUntil?: Timestamp | null;
    };
    const now = Date.now();
    if (cred.lockedUntil && cred.lockedUntil.toMillis() > now) return 'locked';
    if ((cred.failedAttempts ?? 0) >= MAX_FAILED_ATTEMPTS) {
      tx.update(credRef, {
        failedAttempts: 0,
        lockedUntil: Timestamp.fromMillis(now + LOCKOUT_MS),
      });
      return 'locked';
    }
    tx.update(credRef, { failedAttempts: (cred.failedAttempts ?? 0) + 1 });
    return cred.passwordHash;
  });
  if (gate === null || gate === 'locked') {
    await verifyPassword(password, DUMMY_HASH);
    return WRONG;
  }
  if (!(await verifyPassword(password, gate))) return WRONG;

  const token = randomBytes(32).toString('base64url');
  const batch = db.batch();
  batch.set(db.collection('crewSessions').doc(sha256(token)), {
    crewId: member.id,
    createdAt: FieldValue.serverTimestamp(),
    expiresAt: Timestamp.fromMillis(Date.now() + CREW_SESSION_MAX_AGE_S * 1000),
    userAgent: userAgent?.slice(0, 300) ?? null,
  });
  batch.update(credRef, { failedAttempts: 0, lockedUntil: null });
  batch.update(member.ref, { lastSignInAt: FieldValue.serverTimestamp() });
  await batch.commit();
  return { ok: true, token };
}

export async function endCrewSession(token: string): Promise<void> {
  await adminDb().collection('crewSessions').doc(sha256(token)).delete();
}

function scryptAsync(
  password: string,
  salt: Buffer,
  keyLength: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLength, options, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}

/**
 * Checks a password against the string `hashCrewPassword` in
 * functions/src/lib/crew-password.ts stores:
 * `scrypt:<N>:<r>:<p>:<salt>:<hash>`. Keep the two in sync.
 */
async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, hash] = stored.split(':');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64url');
  const actual = await scryptAsync(
    password.trim(),
    Buffer.from(salt, 'base64url'),
    expected.length,
    { N: Number(n), r: Number(r), p: Number(p) },
  );
  return timingSafeEqual(actual, expected);
}

/* -------------------------------------------------------------------------- */
/* Schedule                                                                   */
/* -------------------------------------------------------------------------- */

/** One boat departure: every booking going out in the same date + slot. */
export interface CrewDeparture {
  date: string;
  timeSlot: TourTimeSlot;
  tourId: string;
  type: TourType;
  guests: number;
  bookings: number;
}

/**
 * Departures from `today` (marina date) on: confirmed bookings, plus old-site
 * bookings held with a deposit (imported as `pending-payment`), the same rule
 * as the admin dashboard. A new-site `pending-payment` is someone still in
 * Stripe checkout, not a guest. Reads only the fields the schedule shows — no
 * customer names, emails, phones, or payments.
 */
export async function fetchCrewSchedule(today: string): Promise<CrewDeparture[]> {
  const snap = await adminDb()
    .collection('bookings')
    .where('status', 'in', ['confirmed', 'pending-payment'])
    .where('date', '>=', today)
    .select('date', 'timeSlot', 'tourId', 'type', 'guestCount', 'status')
    .get();

  const byDeparture = new Map<string, CrewDeparture>();
  for (const doc of snap.docs) {
    if (doc.get('status') === 'pending-payment' && !doc.id.startsWith('legacy-')) continue;
    const b = doc.data() as {
      date: string;
      timeSlot: TourTimeSlot;
      tourId: string;
      type: TourType;
      guestCount: number;
    };
    const key = `${b.date}|${b.timeSlot}`;
    const existing = byDeparture.get(key);
    if (existing) {
      existing.guests += b.guestCount;
      existing.bookings += 1;
    } else {
      byDeparture.set(key, {
        date: b.date,
        timeSlot: b.timeSlot,
        tourId: b.tourId,
        type: b.type,
        guests: b.guestCount,
        bookings: 1,
      });
    }
  }
  return [...byDeparture.values()];
}

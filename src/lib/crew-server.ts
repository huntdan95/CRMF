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
import { calledOffDepartures, departureOff, fetchClosedDays, type DepartureOff } from './closed-departures';
import { waiverCoverage, type WaiverForCoverage } from './waiver/people';
import { tours } from './tours';

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
  email: string | null;
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
    const { name, email } = member.data() as { name: string; email?: string | null };
    return { id: member.id, name, email: email ?? null };
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
  /**
   * Of those bookings, old-site ones with no party size on file: `guests`
   * leaves them out, so the headcount is "at least" (the calendar feed's
   * unknownPartyBookings).
   */
  unknownParty: number;
  /**
   * Waiver status for everyone on the boat: no one boards without one.
   * `missing` names roster guests with no signed waiver; `unnamed` counts
   * guests the bookings never named who still need one; `unknown` counts
   * old-site bookings with no party size on file, whose signers count but
   * which are never all signed. Bookings asked to pick a new date don't
   * count, the same as their guests.
   */
  waivers: { signed: number; needed: number; missing: string[]; unnamed: number; unknown: number };
  /** Travis is running it without crew (`soloTrips`, set in admin). */
  noCrew: boolean;
  /**
   * Set when Travis closed this departure (src/lib/closed-departures.ts):
   * `cancelled` isn't going out; `closing` is being called off right now
   * (the crew hear when it's final); `closed-booked` is closed to new
   * bookings with guests still on it, and Travis is contacting them.
   * Listed anyway so the crew see it's off rather than wondering where it
   * went.
   */
  off: DepartureOff | null;
}

/**
 * Departures from `today` (marina date) on: confirmed bookings, plus old-site
 * bookings held with a deposit (imported as `pending-payment`), the same rule
 * as the admin dashboard. A new-site `pending-payment` is someone still in
 * Stripe checkout, not a guest. Reads only the fields the schedule shows: the
 * guests' names (for the waiver check at the dock), no emails, phones, or
 * payments.
 *
 * Departures Travis closed come back with `off` set, including ones whose
 * bookings were all cancelled. Bookings asked to pick a new date don't
 * count towards a departure that is still going out.
 */
export async function fetchCrewSchedule(today: string): Promise<CrewDeparture[]> {
  const db = adminDb();
  const [snap, closed, solo] = await Promise.all([
    db
      .collection('bookings')
      .where('status', 'in', ['confirmed', 'pending-payment'])
      .where('date', '>=', today)
      .select('date', 'timeSlot', 'tourId', 'type', 'guestCount', 'status', 'guests', 'closure.blackoutId')
      .get(),
    fetchClosedDays(today),
    db.collection('soloTrips').where('date', '>=', today).select().get(),
  ]);
  // Doc ids are `YYYY-MM-DD_<timeSlot>`, the same as trip photos.
  const soloTrips = new Set(solo.docs.map((d) => d.id));
  const docs = snap.docs.filter(
    (doc) => doc.get('status') !== 'pending-payment' || doc.id.startsWith('legacy-'),
  );
  const waivers = await waiversByBooking(docs.map((d) => d.id));

  type Acc = CrewDeparture & { live: number; liveGuests: number; liveUnknown: number; moving: number };
  const byDeparture = new Map<string, Acc>();
  const add = (b: { date: string; timeSlot: TourTimeSlot; tourId: string; type: TourType }) => {
    const key = `${b.date}|${b.timeSlot}`;
    let dep = byDeparture.get(key);
    if (!dep) {
      dep = {
        date: b.date,
        timeSlot: b.timeSlot,
        tourId: b.tourId,
        type: b.type,
        guests: 0,
        bookings: 0,
        unknownParty: 0,
        waivers: { signed: 0, needed: 0, missing: [], unnamed: 0, unknown: 0 },
        noCrew: soloTrips.has(`${b.date}_${b.timeSlot}`),
        off: null,
        live: 0,
        liveGuests: 0,
        liveUnknown: 0,
        moving: 0,
      };
      byDeparture.set(key, dep);
    }
    return dep;
  };
  for (const doc of docs) {
    const b = doc.data() as {
      date: string;
      timeSlot: TourTimeSlot;
      tourId: string;
      type: TourType;
      guestCount: number;
      guests?: Array<{ name: string; age: number | null }>;
      closure?: { blackoutId?: string };
    };
    const dep = add(b);
    // guestCount is 0 when the old site didn't record the party size.
    const known = b.guestCount > 0 ? b.guestCount : 0;
    const unknown = known ? 0 : 1;
    dep.guests += known;
    dep.bookings += 1;
    dep.unknownParty += unknown;
    if (b.closure) dep.moving += 1;
    else {
      dep.live += 1;
      dep.liveGuests += known;
      dep.liveUnknown += unknown;
      const coverage = waiverCoverage(b.guests ?? [], b.guestCount, waivers.get(doc.id) ?? []);
      const missing = coverage.roster.filter((r) => !r.covered).map((r) => r.name);
      dep.waivers.signed += coverage.signedCount;
      dep.waivers.needed += coverage.needed;
      dep.waivers.missing.push(...missing);
      dep.waivers.unnamed += Math.max(0, coverage.needed - coverage.signedCount - missing.length);
      if (coverage.needed === 0) dep.waivers.unknown += 1;
    }
  }

  const out: CrewDeparture[] = [];
  for (const { live, liveGuests, liveUnknown, moving, ...dep } of byDeparture.values()) {
    const off = departureOff(dep.date, dep.timeSlot, { live, moving }, closed);
    // Still going out: count only the guests who weren't asked to move.
    out.push(
      off || moving === 0
        ? { ...dep, off }
        : { ...dep, guests: liveGuests, bookings: live, unknownParty: liveUnknown, off },
    );
  }
  // Called off and everyone cancelled: keep it on the list, marked.
  for (const d of calledOffDepartures(closed, today)) {
    if (byDeparture.has(`${d.date}|${d.timeSlot}`)) continue;
    const tour = tours.find((t) => t.timeSlot === d.timeSlot);
    out.push({
      date: d.date,
      timeSlot: d.timeSlot,
      tourId: tour?.id ?? '',
      type: tour?.type ?? 'shared',
      guests: d.guests,
      bookings: d.bookings,
      unknownParty: d.unknownParty,
      waivers: { signed: 0, needed: 0, missing: [], unnamed: 0, unknown: 0 },
      noCrew: soloTrips.has(`${d.date}_${d.timeSlot}`),
      off: { kind: 'cancelled', reason: d.reason },
    });
  }
  return out;
}

/**
 * Signed waivers for these bookings, oldest first (coverage keeps the
 * earliest). By booking, not trip date: a moved booking keeps its waivers.
 */
async function waiversByBooking(bookingIds: string[]): Promise<Map<string, WaiverForCoverage[]>> {
  const out = new Map<string, Array<WaiverForCoverage & { at: number }>>();
  const chunks: string[][] = [];
  // Firestore's `in` takes at most 30 values. All at once: a busy season
  // is dozens of lookups, too slow one after another for opening the app.
  for (let i = 0; i < bookingIds.length; i += 30) chunks.push(bookingIds.slice(i, i + 30));
  const snaps = await Promise.all(
    chunks.map((chunk) =>
      adminDb()
        .collection('waivers')
        .where('bookingId', 'in', chunk)
        .select('bookingId', 'signer', 'minors', 'signedAt')
        .get(),
    ),
  );
  for (const snap of snaps) {
    for (const d of snap.docs) {
      const w = d.data() as WaiverForCoverage & { bookingId: string; signedAt?: Timestamp };
      const list = out.get(w.bookingId) ?? [];
      list.push({ id: d.id, signer: w.signer, minors: w.minors, at: w.signedAt?.toMillis() ?? 0 });
      out.set(w.bookingId, list);
    }
  }
  for (const list of out.values()) list.sort((a, b) => a.at - b.at);
  return out;
}

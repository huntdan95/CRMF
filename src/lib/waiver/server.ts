import 'server-only';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { adminDb, adminStorage } from '../firebase/admin';
import type { Booking, TourTimeSlot } from '../firebase/types';
import { marinaNow } from '../availability';
import { formatFriendlyDate, isValidIsoDate } from '../date';
import { getTourBySlug } from '../tours';
import {
  WAIVER_VERSION,
  type GuardianRelationship,
  initialedSections,
  waiverDocument,
  waiverPlainText,
} from './agreement';
import { ADULT_AGE, ageOn, nameKey } from './people';
import { renderSignedWaiverPdf } from './pdf';
import type { SignedWaiver } from './types';

/*
 * Signing and reading waivers. Runs in the Next app with the Admin SDK;
 * guests never touch Firestore or Storage directly.
 *
 * Signing links look like /waiver/{bookingId}?k={waiverKey}. The key is
 * derived from the booking's accessToken, so it works for every booking
 * without a new field, but it can't be turned back into the accessToken:
 * whoever the booker forwards the link to can sign, and can't cancel the
 * booking from /my-booking.
 */

const BOOKING_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function sha256Hex(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

/** Must match `waiverKey` in functions/src/lib/waiver-link.ts. */
export function waiverKey(accessToken: string): string {
  return createHash('sha256').update(`waiver-link:${accessToken}`).digest('base64url').slice(0, 32);
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * The booking, when `key` (a signing link) or `token` (the booker's own
 * accessToken) matches it. `null` otherwise, including for unknown ids.
 */
export async function bookingForWaiver(
  bookingId: string,
  cred: { key?: string | null; token?: string | null },
): Promise<Booking | null> {
  if (!BOOKING_ID.test(bookingId)) return null;
  const snap = await adminDb().collection('bookings').doc(bookingId).get();
  if (!snap.exists) return null;
  const booking = { ...(snap.data() as Booking), id: snap.id };
  if (!booking.accessToken) return null;
  if (cred.key && safeEqual(cred.key, waiverKey(booking.accessToken))) return booking;
  if (cred.token && safeEqual(cred.token, booking.accessToken)) return booking;
  return null;
}

export type SignableState = 'open' | 'cancelled' | 'unpaid' | 'past';

export function signableState(booking: Booking, today: string): SignableState {
  if (booking.status === 'cancelled') return 'cancelled';
  // Old-site bookings held with a deposit are imported as pending-payment
  // but are real guests (the crew schedule and admin count them too). A
  // new-site pending-payment is someone still in Stripe checkout.
  if (booking.status === 'pending-payment' && !booking.id.startsWith('legacy-')) return 'unpaid';
  if (booking.status === 'no-show' || booking.date < today) return 'past';
  return 'open';
}

export function tripIdFor(date: string, timeSlot: string): string {
  return `${date}_${timeSlot}`;
}

/** "Saturday, October 17, 2026 · 8:00 AM – 10:00 AM". */
export function tripWhen(booking: Pick<Booking, 'date' | 'tourId'>): string {
  const tour = getTourBySlug(booking.tourId);
  const time = tour ? ` · ${tour.startTimeDisplay} – ${tour.endTimeDisplay}` : '';
  return `${formatFriendlyDate(booking.date)}${time}`;
}

export interface SignedSummary {
  signer: string;
  participating: boolean;
  rosterName: string | null;
  minors: Array<{ name: string; rosterName: string | null }>;
}

/** Who has signed for a booking so far — names only, for the signing page. */
export async function signedSummaries(bookingId: string): Promise<SignedSummary[]> {
  const snap = await adminDb()
    .collection('waivers')
    .where('bookingId', '==', bookingId)
    .select('signer', 'minors')
    .get();
  return snap.docs.map((d) => {
    const w = d.data() as Pick<SignedWaiver, 'signer' | 'minors'>;
    return {
      signer: w.signer.name,
      participating: w.signer.participating,
      rosterName: w.signer.rosterName,
      minors: w.minors.map((m) => ({ name: m.name, rosterName: m.rosterName })),
    };
  });
}

/* -------------------------------------------------------------------------- */
/* Signing                                                                    */
/* -------------------------------------------------------------------------- */

export interface SignWaiverInput {
  bookingId: string;
  key: string;
  version: string;
  /** SHA-256 of `waiverPlainText()` as the signer's browser rendered it. */
  documentSha256: string;
  signer: {
    name: string;
    dob: string;
    email: string;
    phone: string;
    address: string;
    participating: boolean;
    rosterName: string | null;
  };
  minors: Array<{
    name: string;
    dob: string;
    rosterName: string | null;
    relationship: GuardianRelationship;
  }>;
  accompanyingAdult: string | null;
  guardianAttested: boolean;
  initials: Array<{ section: string; initials: string; at: string }>;
  consentElectronic: true;
  signaturePng: string;
  signatureMethod: 'drawn' | 'typed';
  clientSignedAt: string;
  clientTimeZone: string | null;
}

export type SignWaiverResult =
  | { ok: true; waiverId: string; copyToken: string }
  | { ok: false; status: number; error: string; field?: string };

const PNG_PREFIX = 'data:image/png;base64,';
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_SIGNATURE_BYTES = 300 * 1024;

const CLOSED_MESSAGE: Record<Exclude<SignableState, 'open'>, string> = {
  cancelled: 'This booking was cancelled, so there’s nothing to sign.',
  unpaid: 'This booking isn’t paid yet. Waivers open once it’s confirmed.',
  past: 'This trip has already happened.',
};

/** JSON with object keys sorted, so the same record always hashes the same. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * ASCII-only filename part. It goes in a Content-Disposition header, which
 * can't carry characters past Latin-1: "王伟" or "Łukasz" there makes the
 * PDF download fail. (nameKey keeps every script, so it can't be used.)
 */
function slug(s: string): string {
  return (
    s
      .normalize('NFKD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'guest'
  );
}

export async function signWaiver(
  input: SignWaiverInput,
  meta: { ip: string | null; userAgent: string | null },
): Promise<SignWaiverResult> {
  const booking = await bookingForWaiver(input.bookingId, { key: input.key });
  if (!booking) {
    return { ok: false, status: 403, error: 'This waiver link isn’t valid. Ask the person who booked to resend it.' };
  }

  const today = marinaNow().date;
  const state = signableState(booking, today);
  if (state !== 'open') return { ok: false, status: 409, error: CLOSED_MESSAGE[state] };

  if (input.version !== WAIVER_VERSION) {
    return {
      ok: false,
      status: 409,
      error: 'The waiver was just updated. Reload the page to see the current version, then sign again.',
    };
  }

  const { signer, minors } = input;
  if (!isValidIsoDate(signer.dob) || signer.dob > today || ageOn(signer.dob, today) > 120) {
    return { ok: false, status: 400, error: 'Check your date of birth.', field: 'signer.dob' };
  }
  if (ageOn(signer.dob, today) < ADULT_AGE) {
    return {
      ok: false,
      status: 400,
      field: 'signer.dob',
      // Turning 18 by the trip: a parent can't sign for them (they'll be an
      // adult on the boat), and they can't sign yet. Say when they can.
      error:
        ageOn(signer.dob, booking.date) >= ADULT_AGE
          ? 'You turn 18 before the trip, so you sign your own waiver, once you’re 18. Come back to this link on or after your birthday.'
          : 'You need to be 18 or older to sign. A parent or legal guardian has to sign for anyone under 18.',
    };
  }

  for (const [i, m] of minors.entries()) {
    if (!isValidIsoDate(m.dob) || m.dob > today) {
      return { ok: false, status: 400, error: `Check ${m.name}’s date of birth.`, field: `minors.${i}.dob` };
    }
    if (ageOn(m.dob, booking.date) >= ADULT_AGE) {
      return {
        ok: false,
        status: 400,
        field: `minors.${i}.dob`,
        error: `${m.name} will be 18 or older on the trip date, so they sign their own waiver.`,
      };
    }
  }
  const minorKeys = new Set(minors.map((m) => nameKey(m.name)));
  if (minorKeys.size !== minors.length) {
    return { ok: false, status: 400, error: 'The same child is listed twice.', field: 'minors' };
  }
  if (minors.length > 0 && !input.guardianAttested) {
    return {
      ok: false,
      status: 400,
      field: 'guardianAttested',
      error: 'Only a parent or legal guardian can sign for a child. Confirm you are one.',
    };
  }
  if (!signer.participating && minors.length === 0) {
    return {
      ok: false,
      status: 400,
      field: 'minors',
      error: 'If you’re not going on the tour, add the child or children you’re signing for.',
    };
  }
  const accompanyingAdult = signer.participating ? null : input.accompanyingAdult?.trim() || null;
  if (!signer.participating && !accompanyingAdult) {
    return {
      ok: false,
      status: 400,
      field: 'accompanyingAdult',
      error: 'Tell us which adult will be with your child on the boat.',
    };
  }

  const doc = waiverDocument({ withMinors: minors.length > 0 });
  const documentText = waiverPlainText(doc);
  const documentSha256 = sha256Hex(documentText);
  // The browser hashes the text it showed; it must be this exact text. A
  // mismatch means a stale page or a wording change without a version bump.
  if (input.documentSha256 !== documentSha256) {
    return {
      ok: false,
      status: 409,
      error: 'The waiver was just updated. Reload the page to see the current version, then sign again.',
    };
  }
  const required = initialedSections(doc).map((s) => s.id);
  const given = new Map(input.initials.map((i) => [i.section, i]));
  const missing = required.filter((id) => !given.get(id)?.initials.trim());
  if (missing.length > 0 || given.size !== required.length) {
    return {
      ok: false,
      status: 400,
      field: 'initials',
      error: 'Initial every section of the waiver before signing.',
    };
  }

  if (!input.signaturePng.startsWith(PNG_PREFIX)) {
    return { ok: false, status: 400, error: 'Draw your signature, then try again.', field: 'signature' };
  }
  const signature = Buffer.from(input.signaturePng.slice(PNG_PREFIX.length), 'base64');
  if (
    signature.length < 200 ||
    signature.length > MAX_SIGNATURE_BYTES ||
    !signature.subarray(0, 8).equals(PNG_MAGIC)
  ) {
    return { ok: false, status: 400, error: 'Draw your signature, then try again.', field: 'signature' };
  }

  const db = adminDb();
  // A party is at most a boat's worth; a long tail of signatures on one
  // link means the link is being misused.
  const existing = await db.collection('waivers').where('bookingId', '==', booking.id).count().get();
  if (existing.data().count >= Math.max(20, booking.guestCount * 3)) {
    return {
      ok: false,
      status: 429,
      error: 'This booking already has a lot of signed waivers. Call or text Travis if you still need to sign.',
    };
  }

  const ref = db.collection('waivers').doc();
  const copyToken = randomBytes(24).toString('base64url');
  const signedAt = new Date();
  const tripId = tripIdFor(booking.date, booking.timeSlot);
  const pdfPath = `waivers/${booking.date}/${ref.id}.pdf`;
  const signaturePath = `waivers/${booking.date}/${ref.id}-signature.png`;

  const core = {
    id: ref.id,
    bookingId: booking.id,
    tripId,
    tripDate: booking.date,
    timeSlot: booking.timeSlot as TourTimeSlot,
    tourId: booking.tourId,
    tourName: booking.tourName,
    version: doc.version,
    includesMinorAddendum: doc.minorAddendum !== null,
    documentSha256,
    signer: {
      name: signer.name.trim(),
      dob: signer.dob,
      email: signer.email.trim().toLowerCase(),
      phone: signer.phone.trim(),
      address: signer.address.trim(),
      participating: signer.participating,
      rosterName: signer.rosterName,
    },
    minors: minors.map((m) => ({
      name: m.name.trim(),
      dob: m.dob,
      ageOnTripDate: ageOn(m.dob, booking.date),
      rosterName: m.rosterName,
      relationship: m.relationship,
    })),
    accompanyingAdult,
    guardianAttested: minors.length > 0 && input.guardianAttested,
    initials: input.initials.map((i) => ({
      section: i.section,
      initials: i.initials.trim().toUpperCase(),
      at: i.at,
    })),
    consentElectronic: true as const,
    signatureSha256: sha256Hex(signature),
    signatureMethod: input.signatureMethod,
    signaturePath,
    pdfPath,
    clientSignedAt: input.clientSignedAt,
    clientTimeZone: input.clientTimeZone,
    ip: meta.ip,
    userAgent: meta.userAgent?.slice(0, 400) ?? null,
  };
  const signedAtIso = signedAt.toISOString();
  const recordSha256 = sha256Hex(stableJson({ ...core, signedAt: signedAtIso }));

  const pdf = await renderSignedWaiverPdf({
    record: { ...core, recordSha256, signedAtIso },
    doc,
    signaturePng: input.signaturePng,
    tripWhen: tripWhen(booking),
  });
  const pdfSha256 = sha256Hex(pdf);

  // ifGenerationMatch: 0 — never overwrite an existing signed file.
  // temporaryHold — Cloud Storage refuses to delete or replace the file,
  // even for the Admin SDK, until someone with IAM access releases the
  // hold on purpose.
  const bucket = adminStorage().bucket();
  const fileMeta = { waiverId: ref.id, bookingId: booking.id };
  await Promise.all([
    bucket.file(signaturePath).save(signature, {
      resumable: false,
      contentType: 'image/png',
      metadata: { temporaryHold: true, metadata: { ...fileMeta, sha256: core.signatureSha256 } },
      preconditionOpts: { ifGenerationMatch: 0 },
    }),
    bucket.file(pdfPath).save(pdf, {
      resumable: false,
      contentType: 'application/pdf',
      metadata: { temporaryHold: true, metadata: { ...fileMeta, sha256: pdfSha256 } },
      preconditionOpts: { ifGenerationMatch: 0 },
    }),
    keepDocumentText(doc.version, documentSha256, documentText),
  ]);

  const record: SignedWaiver = {
    ...core,
    recordSha256,
    pdfSha256,
    signedAt: Timestamp.fromDate(signedAt),
    copyTokenSha256: sha256Hex(copyToken),
    emailedAt: null,
  };
  await ref.create(record);

  return { ok: true, waiverId: ref.id, copyToken };
}

/**
 * Keeps the exact wording each hash stands for, so a signed record's
 * `documentSha256` can be checked against the text long after the code
 * has moved on. One document per distinct text; never changed.
 */
async function keepDocumentText(version: string, sha: string, text: string): Promise<void> {
  try {
    await adminDb().collection('waiverTexts').doc(sha).create({
      version,
      sha256: sha,
      text,
      firstSignedAt: Timestamp.now(),
    });
  } catch (err) {
    // ALREADY_EXISTS: someone signed this exact text before.
    if ((err as { code?: number }).code !== 6) throw err;
  }
}

/* -------------------------------------------------------------------------- */
/* Reading the signed PDF                                                     */
/* -------------------------------------------------------------------------- */

export interface WaiverPdf {
  pdf: Buffer;
  filename: string;
}

async function loadPdf(w: SignedWaiver): Promise<WaiverPdf> {
  const [pdf] = await adminStorage().bucket().file(w.pdfPath).download();
  return { pdf, filename: `waiver-${w.tripDate}-${slug(w.signer.name)}.pdf` };
}

async function getWaiver(waiverId: string): Promise<SignedWaiver | null> {
  if (!BOOKING_ID.test(waiverId)) return null;
  const snap = await adminDb().collection('waivers').doc(waiverId).get();
  return snap.exists ? (snap.data() as SignedWaiver) : null;
}

/** The signer's own copy, behind the private token from their success page. */
export async function waiverPdfForSigner(waiverId: string, copyToken: string): Promise<WaiverPdf | null> {
  const w = await getWaiver(waiverId);
  if (!w || !copyToken || !safeEqual(sha256Hex(copyToken), w.copyTokenSha256)) return null;
  return loadPdf(w);
}

/** For admin routes; the caller must have checked the admin session. */
export async function waiverPdfForAdmin(waiverId: string): Promise<WaiverPdf | null> {
  const w = await getWaiver(waiverId);
  return w ? loadPdf(w) : null;
}

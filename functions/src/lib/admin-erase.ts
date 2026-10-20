import { logger } from 'firebase-functions/v2';
import type { DocumentReference, Firestore } from 'firebase-admin/firestore';

import { db as defaultDb, FieldValue } from './firebase';
import { marinaNow } from './datetime';
import type { Booking } from './types';

/*
 * Admin's "Erase personal details", for a past or cancelled customer who
 * asks to be forgotten (the privacy policy promises to delete what isn't
 * legally required). It blanks who they are and keeps what happened:
 *
 *   bookings/{id}            name, email, phone, emergency contact, guest
 *                            names and ages, the private notes, bounced
 *                            addresses and the checkout's IP hash. Money,
 *                            Stripe ids, dates, the tour and wetsuit sizes
 *                            stay, for the books.
 *   auditLog                 the booking's entries (and those about its
 *                            reschedule requests and the contact messages
 *                            below): the before/after details, notes and
 *                            addresses, and any mention of them elsewhere.
 *   emailLog                 entries for the booking or to their address
 *                            (recipient, subject, bounce message), and
 *                            Travis's own notices (private feedback, "Crew
 *                            not told", contact-form messages) whose
 *                            subject names the customer.
 *   closureActions           the customer's name in a closure's results.
 *   rescheduleRequests       the booking's: their address and their note.
 *   guestFeedback            the booking's: their name, address and message.
 *   contactMessages          ones from their address, however it was
 *                            capitalised: name, address, phone, message.
 *
 * Not touched: the signed waivers, kept 7 years as the policy says (and the
 * emails that sent each signer their copy, logged against the waiver), and
 * anything outside Firestore: emails already in inboxes, Stripe's and
 * Resend's own records, trip photos (Trip photos deletes those).
 *
 * The copies are found from the booking as it is, so the booking is
 * erased last: one that fails partway is erased again from the start.
 */

export type AdminEraseOutcome =
  | { kind: 'erased'; copies: ErasedCopies }
  | { kind: 'not-found' }
  | { kind: 'already-erased' }
  /** Neither cancelled nor past its trip date (marina time): it may still happen. */
  | { kind: 'not-over' }
  /** Travis closed the departure and the customer can still pick a new date. */
  | { kind: 'still-choosing' };

/** How many documents of each kind had something erased. */
export interface ErasedCopies {
  auditLog: number;
  emailLog: number;
  closureActions: number;
  rescheduleRequests: number;
  guestFeedback: number;
  contactMessages: number;
}

/** What an erased detail reads as in a log, so the entry still makes sense. */
export const ERASED = '[erased]';

/**
 * Fields in an audit entry that are someone's details whatever they hold:
 * the before/after of an edit, a reset's or a resend's address, the
 * sender of a contact message, notes on a booking or a request.
 */
const AUDIT_DETAIL_KEYS = new Set([
  'customerName',
  'customerEmail',
  'customerPhone',
  'emergencyContactName',
  'emergencyContactPhone',
  'guests',
  'to',
  'bouncedTo',
  'from',
  'adminNotes',
  'notes',
]);

/**
 * Whether a booking can be erased: cancelled, marked (the trip happened,
 * or they didn't come), or its trip date has passed (marina time). Not one
 * whose customer can still answer a closure offer: they have until after
 * the closed date to pick a new one.
 */
export function erasable(b: Pick<Booking, 'status' | 'date' | 'closure'>, now?: Date): 'ok' | 'not-over' | 'still-choosing' {
  if (b.status === 'cancelled') return 'ok';
  if (b.status !== 'completed' && b.status !== 'no-show' && !(b.date < marinaNow(now).date)) return 'not-over';
  return b.closure ? 'still-choosing' : 'ok';
}

/** Any detail in `value` replaced, everything else as it was. */
type Scrub = (value: unknown) => unknown;

const isPlain = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype;

/** A value with every string in it erased (`ERASED`, or '' left as ''), every number null. */
function eraseAll(value: unknown): unknown {
  if (typeof value === 'string') return value ? ERASED : value;
  if (typeof value === 'number') return null;
  if (Array.isArray(value)) return value.map(eraseAll);
  if (isPlain(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, eraseAll(v)]));
  return value;
}

/**
 * Replaces each of `terms` (names, addresses, phone numbers) wherever it
 * appears in a string, as a whole word and ignoring case, in plain
 * objects and arrays too. Timestamps and other values stay. `keys`: fields
 * erased outright, whatever they hold.
 */
export function scrubber(terms: Iterable<string>, keys: ReadonlySet<string> = new Set()): Scrub {
  const words = [...new Set([...terms].map((t) => t.trim()).filter((t) => t.length >= 2))].sort((a, b) => b.length - a.length);
  const escape = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = words.length ? new RegExp(`(?<![\\p{L}\\p{N}])(?:${words.map(escape).join('|')})(?![\\p{L}\\p{N}])`, 'giu') : null;
  const scrub: Scrub = (value) => {
    if (typeof value === 'string') return re ? value.replace(re, ERASED) : value;
    if (Array.isArray(value)) return value.map(scrub);
    if (isPlain(value)) {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, keys.has(k) ? eraseAll(v) : scrub(v)]));
    }
    return value;
  };
  return scrub;
}

/** Where an audit payload keeps the customer's own name, address and phone, as they were then. */
const CUSTOMER_KEYS = new Set(['customerName', 'customerEmail', 'customerPhone', 'to', 'bouncedTo', 'from']);
/** And their party's. */
const PARTY_KEYS = new Set(['emergencyContactName', 'emergencyContactPhone', 'guests']);

/** Every string under one of `keys` in an audit payload: names and addresses as earlier edits had them. */
function detailsIn(value: unknown, keys: ReadonlySet<string>, out: Set<string>, under = false): void {
  if (typeof value === 'string') {
    if (under && value) out.add(value);
  } else if (Array.isArray(value)) {
    value.forEach((v) => detailsIn(v, keys, out, under));
  } else if (isPlain(value)) {
    for (const [k, v] of Object.entries(value)) {
      // A guest's wetsuit size isn't who they are.
      if (k !== 'wetsuitSize') detailsIn(v, keys, out, under || keys.has(k));
    }
  }
}

/** Reads a document and writes back what `patch` makes of it, in a transaction. Whether it changed. */
async function rewrite(db: Firestore, ref: DocumentReference, patch: (data: Record<string, unknown>) => Record<string, unknown> | null): Promise<boolean> {
  return db.runTransaction(async (tx) => {
    const data = (await tx.get(ref)).data() as Record<string, unknown> | undefined;
    if (!data) return false;
    const changes = patch(data);
    if (!changes) return false;
    const changed = Object.fromEntries(Object.entries(changes).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(data[k])));
    if (Object.keys(changed).length === 0) return false;
    tx.update(ref, changed);
    return true;
  });
}

/** The ids of every document the queries find, once each. */
async function idsOf(queries: Array<{ get(): Promise<{ docs: Array<{ id: string }> }> }>): Promise<string[]> {
  const snaps = await Promise.all(queries.map((q) => q.get()));
  return [...new Set(snaps.flatMap((s) => s.docs.map((d) => d.id)))];
}

/**
 * Erases a booking's customer from the booking and its copies (see the top
 * of this file). Admin site only, and audited by the caller without the
 * details erased.
 */
export async function adminEraseOne(
  bookingId: string,
  deps: {
    db?: Firestore;
    now?: Date;
    /** Who erased it, kept on the booking. */
    adminEmail?: string;
    /** Addresses that are never the customer's (Travis's), whatever an entry has them under. */
    isStaff?: (address: string) => boolean;
  } = {},
): Promise<AdminEraseOutcome> {
  const db = deps.db ?? defaultDb;
  const ref = db.collection('bookings').doc(bookingId);
  const booking = (await ref.get()).data() as Booking | undefined;
  if (!booking) return { kind: 'not-found' };
  if ((booking as Booking & { erasedAt?: unknown }).erasedAt) return { kind: 'already-erased' };
  const allowed = erasable(booking, deps.now);
  if (allowed !== 'ok') return { kind: allowed };

  // Who they are: on the booking now, and as earlier edits had it (an
  // address fixed after a bounce, a name corrected).
  const audit = db.collection('auditLog');
  const ownEntries = await idsOf([audit.where('targetId', '==', bookingId), audit.where('payload.bookingId', '==', bookingId)]);
  const earlier = new Set<string>();
  const earlierParty = new Set<string>();
  for (const id of ownEntries) {
    const payload = (await audit.doc(id).get()).data()?.payload;
    detailsIn(payload, CUSTOMER_KEYS, earlier);
    detailsIn(payload, PARTY_KEYS, earlierParty);
  }
  for (const bounce of Object.values(booking.emailBounces ?? {})) if (bounce?.to) earlier.add(bounce.to);
  for (const t of earlier) if (deps.isStaff?.(t)) earlier.delete(t);

  const contact = [booking.customerName, booking.customerEmail, booking.customerPhone, ...earlier];
  const party = [booking.emergencyContactName, booking.emergencyContactPhone, ...(booking.guests ?? []).map((g) => g.name), ...earlierParty];
  const terms = [...contact, ...party].filter((t): t is string => typeof t === 'string' && !!t.trim());
  const addresses = [...new Set(contact.filter((t): t is string => typeof t === 'string' && t.includes('@')).flatMap((a) => [a.trim(), a.trim().toLowerCase()]))];
  // The customer as Travis's own notices name them: not their guests' or
  // emergency contact's first names, which other customers' subjects may
  // share.
  const customerTerms = contact.filter((t): t is string => typeof t === 'string' && t.trim().length >= 3);
  const scrubAll = scrubber(terms);
  const scrubAudit = scrubber(terms, AUDIT_DETAIL_KEYS);
  const scrubCustomer = scrubber(customerTerms);
  const mentionsCustomer = (s: unknown) => typeof s === 'string' && scrubCustomer(s) !== s;

  const copies: ErasedCopies = { auditLog: 0, emailLog: 0, closureActions: 0, rescheduleRequests: 0, guestFeedback: 0, contactMessages: 0 };

  // Their date-change requests, private feedback and contact messages.
  const requests = await idsOf([db.collection('rescheduleRequests').where('bookingId', '==', bookingId)]);
  for (const id of requests) {
    const changed = await rewrite(db, db.collection('rescheduleRequests').doc(id), (r) => ({
      bookingCustomerEmail: '',
      ...(r.notes ? { notes: ERASED } : {}),
      ...(r.adminNotes ? { adminNotes: ERASED } : {}),
    }));
    if (changed) copies.rescheduleRequests++;
  }
  const feedback = await idsOf([db.collection('guestFeedback').where('bookingId', '==', bookingId)]);
  for (const id of feedback) {
    const changed = await rewrite(db, db.collection('guestFeedback').doc(id), (f) => ({
      customerName: f.customerName ? ERASED : '',
      customerEmail: '',
      message: ERASED,
    }));
    if (changed) copies.guestFeedback++;
  }
  // The form keeps the address as it was typed, capitals and all, so
  // they're all read and compared ignoring case: there aren't many.
  const lower = new Set(addresses.map((a) => a.toLowerCase()));
  const messages = lower.size
    ? (await db.collection('contactMessages').get()).docs
        .filter((d) => lower.has(String(d.data().email ?? '').trim().toLowerCase()))
        .map((d) => d.id)
    : [];
  for (const id of messages) {
    const changed = await rewrite(db, db.collection('contactMessages').doc(id), (m) => ({
      name: ERASED,
      email: '',
      phone: null,
      subject: m.subject ? ERASED : null,
      message: ERASED,
    }));
    if (changed) copies.contactMessages++;
  }

  // The audit log: the booking's entries, and those about the requests and messages above.
  const entries = new Set([
    ...ownEntries,
    ...(await idsOf([
      ...requests.map((id) => audit.where('targetId', '==', `rescheduleRequest/${id}`)),
      ...messages.map((id) => audit.where('targetId', '==', `contactMessage/${id}`)),
    ])),
  ]);
  for (const id of entries) {
    const changed = await rewrite(db, audit.doc(id), (e) => {
      const payload = scrubAudit(e.payload ?? {}) as Record<string, unknown>;
      // A note's before and after (booking.note) are the notes themselves.
      if ((e.payload as Record<string, unknown> | undefined)?.field === 'adminNotes') {
        payload.before = eraseAll(payload.before);
        payload.after = eraseAll(payload.after);
      }
      return { payload };
    });
    if (changed) copies.auditLog++;
  }

  // The email log: the booking's emails and any to their address, except
  // a signer's copy of their waiver, which belongs to the waiver's record;
  // and Travis's own notices that name them without being filed under the
  // booking.
  const log = db.collection('emailLog');
  const tied = await idsOf([log.where('bookingId', '==', bookingId), ...addresses.map((a) => log.where('to', 'array-contains', a))]);
  const notices = (await log.where('kind', 'in', ['admin', 'contact']).get()).docs
    .filter((d) => !tied.includes(d.id) && mentionsCustomer(d.data().subject))
    .map((d) => d.id);
  for (const id of [...tied, ...notices]) {
    const changed = await rewrite(db, log.doc(id), (e) =>
      e.waiverId
        ? null
        : Object.fromEntries(['to', 'subject', 'bounceMessage', 'events'].filter((k) => k in e).map((k) => [k, scrubAll(e[k])])),
    );
    if (changed) copies.emailLog++;
  }

  // Closures name each booking they touched in their results.
  const actions = db.collection('closureActions');
  const closures = await idsOf([actions.where('previewBookingIds', 'array-contains', bookingId), actions.where('targetIds', 'array-contains', bookingId)]);
  for (const id of closures) {
    const changed = await rewrite(db, actions.doc(id), (a) => {
      const named = (entry: unknown) =>
        isPlain(entry) && entry.id === bookingId && typeof entry.customerName === 'string' && entry.customerName
          ? { ...entry, customerName: ERASED }
          : entry;
      const result = isPlain(a.result)
        ? Object.fromEntries(Object.entries(a.result).map(([k, v]) => [k, Array.isArray(v) ? v.map(named) : v]))
        : undefined;
      const progress = isPlain(a.progress) && isPlain(a.progress[bookingId])
        ? { ...a.progress, [bookingId]: { ...a.progress[bookingId], entry: named(a.progress[bookingId].entry) } }
        : undefined;
      return { ...(result && { result }), ...(progress && { progress }) };
    });
    if (changed) copies.closureActions++;
  }

  // Last, the booking itself, if it still may be.
  const outcome = await db.runTransaction<AdminEraseOutcome>(async (tx) => {
    const fresh = (await tx.get(ref)).data() as (Booking & { erasedAt?: unknown }) | undefined;
    if (!fresh) return { kind: 'not-found' };
    if (fresh.erasedAt) return { kind: 'already-erased' };
    const still = erasable(fresh, deps.now);
    if (still !== 'ok') return { kind: still };
    tx.update(ref, {
      customerName: '',
      customerEmail: '',
      customerPhone: '',
      emergencyContactName: '',
      emergencyContactPhone: '',
      guests: (fresh.guests ?? []).map((g) => ({ ...g, name: '', age: null })),
      adminNotes: '',
      ...(fresh.cancellationReason ? { cancellationReason: scrubAll(fresh.cancellationReason) } : {}),
      // Each names the address it bounced from; there's no address to fix now.
      emailBounces: FieldValue.delete(),
      checkoutIpHash: FieldValue.delete(),
      // A closure's cancellation email still to resend: there's nobody to send it to.
      deadlineEmail: FieldValue.delete(),
      ...(fresh.legacy ? { 'legacy.billing': FieldValue.delete() } : {}),
      erasedAt: FieldValue.serverTimestamp(),
      ...(deps.adminEmail ? { erasedBy: deps.adminEmail } : {}),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { kind: 'erased', copies };
  });
  if (outcome.kind !== 'erased') {
    logger.warn('Erasing a booking: its copies were erased, but the booking changed meanwhile and was left', { bookingId, outcome: outcome.kind });
  }
  return outcome;
}

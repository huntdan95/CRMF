import { createHash, randomBytes } from 'node:crypto';
import { logger } from 'firebase-functions/v2';
import type { Firestore } from 'firebase-admin/firestore';
import type Stripe from 'stripe';

import { db as defaultDb, FieldValue, Timestamp } from './firebase';
import { adminCancelOne, type CancellationMailer } from './admin-cancel';
import type { AdminContext } from './admin-auth';
import { WHOLE_DAY_OVERLAPS } from './availability';
import { canOfferMove, closureDecideBy, markClosed } from './closure';
import { isRealDate, marinaNow, type MarinaClock } from './datetime';
import {
  buildCancellationEmail,
  buildClosureOfferEmail,
  buildCrewClosureAlertEmail,
} from './email-templates';
import { SLOT_START_TIMES } from './schedule';
import {
  isLegacyBooking,
  type AuditAction,
  type BlackoutReason,
  type BlackoutSlot,
  type Booking,
  type ClosureAction,
  type ClosureChoice,
  type ClosureResult,
  type TourTimeSlot,
} from './types';

/*
 * Closing a day from Admin -> Close a day, with the safeguards that stop
 * Travis cancelling the wrong day or the wrong trips by accident:
 *
 *  1. previewClosure: what closing these departures would do to whom,
 *     with the exact emails, and a single-use confirm token per choice.
 *     The preview is stored server-side (closurePreviews/{sha256(token)}),
 *     so the date, departures, reason and choice can't be changed after
 *     Travis has looked at them.
 *  2. confirmClosure: in one transaction, re-reads the bookings, refuses if
 *     anything changed since the preview, and closes the departures with a
 *     blackout so nobody can book them. Nothing else happens yet: no
 *     cancellation, refund, closure mark or email. That's the undo window,
 *     recorded in closureActions/{blackoutId} (server-only; blackouts are
 *     public).
 *  3. undoClosure removes the blackout while the action is still pending.
 *  4. finalizeClosure, from "Send now" or the every-minute scheduler,
 *     claims the action in a transaction (so the two can't both run it),
 *     re-reads the bookings and runs the choice Travis made, then alerts
 *     the crew once.
 */

export const MARINA = {
  name: "Pete's Pier Marina",
  address: '1 SW First Place, Crystal River, FL 34429',
};
export const PHONE_DISPLAY = '352-586-7792';

/** Undo window when Settings has none. */
export const DEFAULT_UNDO_MINUTES = 10;
export const MAX_UNDO_MINUTES = 60;
/** A preview older than this has to be looked at again. */
export const PREVIEW_TTL_MS = 30 * 60 * 1000;
/**
 * A finalize that crashed leaves its action `finalizing`. After this long
 * (longer than a function can run) the scheduler may claim it again. Every
 * step of a finalize is safe to repeat.
 */
export const FINALIZE_LEASE_MS = 15 * 60 * 1000;
/** Dates this far out get the "Forecasts change" warning. */
export const FAR_AHEAD_DAYS = 3;

/** What customers are told when Travis closes a day. */
const CLOSURE_REASON: Record<string, string> = {
  weather: 'Closed for weather',
  maintenance: 'Closed for boat maintenance',
};

export function customerReason(reason: string | null | undefined): string {
  return CLOSURE_REASON[reason ?? ''] ?? 'Capt. Travis had to close this day';
}

/** The four two-hour departures, in time order. */
const REGULAR_SLOTS: TourTimeSlot[] = ['morning', 'mid-morning', 'early-afternoon', 'late-afternoon'];

/**
 * Whether closing `closed` stops the `slot` departure. A whole-day charter
 * runs through the morning, mid-morning and early-afternoon departures, so
 * closing any of those closes it too. Same rule as the availability check.
 */
export function closesSlot(closed: readonly string[], slot: string): boolean {
  if (closed.includes('all') || closed.includes(slot)) return true;
  return slot === 'whole-day' && closed.some((s) => (WHOLE_DAY_OVERLAPS as readonly string[]).includes(s));
}

/** Minutes after midnight the departure leaves, marina time. */
function startMinutes(slot: TourTimeSlot): number {
  const [h = 0, m = 0] = (SLOT_START_TIMES[slot] ?? '00:00').split(':').map(Number);
  return h * 60 + m;
}

/** Left already (or the date is past), marina time. */
export function departureStarted(date: string, slot: TourTimeSlot, now: MarinaClock): boolean {
  if (date < now.date) return true;
  if (date > now.date) return false;
  return now.minutes >= startMinutes(slot);
}

/** "8:00 AM" */
export function departsDisplay(slot: TourTimeSlot): string {
  const mins = startMinutes(slot);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

/** Still on: confirmed, or an old-site booking or a checkout in progress. */
function isActive(b: Pick<Booking, 'status'>): boolean {
  return b.status === 'confirmed' || b.status === 'pending-payment';
}

export function owedCents(b: Pick<Booking, 'amountPaidCents' | 'amountRefundedCents'>): number {
  return Math.max(0, (b.amountPaidCents ?? 0) - (b.amountRefundedCents ?? 0));
}

function millis(ts: unknown): number | null {
  if (ts && typeof ts === 'object' && typeof (ts as { toMillis?: () => number }).toMillis === 'function') {
    return (ts as { toMillis: () => number }).toMillis();
  }
  return null;
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * Everything about the affected bookings that would change what closing
 * the day does: which bookings, their status, party size, money, contact
 * email, closure and last change. Order doesn't matter.
 */
export function bookingsFingerprint(bookings: Booking[]): string {
  const rows = bookings
    .map((b) => [
      b.id,
      b.status,
      b.date,
      b.timeSlot,
      b.tourId,
      b.type,
      b.guestCount,
      b.amountPaidCents ?? 0,
      b.amountRefundedCents ?? 0,
      b.paymentStatus ?? null,
      b.stripePaymentIntentId ?? null,
      b.customerEmail ?? null,
      b.closure?.blackoutId ?? null,
      millis(b.updatedAt),
    ])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  return sha256(JSON.stringify(rows));
}

/** The active bookings on `date` that closing `slots` hits, in departure order. */
export async function affectedBookings(
  db: Firestore,
  date: string,
  slots: readonly string[],
  tx?: FirebaseFirestore.Transaction,
): Promise<Booking[]> {
  const q = db.collection('bookings').where('date', '==', date);
  const snap = tx ? await tx.get(q) : await q.get();
  return snap.docs
    .map((d) => ({ ...(d.data() as Booking), id: d.id }))
    .filter((b) => isActive(b) && closesSlot(slots, b.timeSlot))
    .sort((a, b) => startMinutes(a.timeSlot) - startMinutes(b.timeSlot) || a.id.localeCompare(b.id));
}

export class ClosureError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    /** `stale`: something changed since the preview; review again. */
    public readonly code?: 'stale' | 'expired' | 'too-late' | 'not-found' | 'busy',
  ) {
    super(message);
    this.name = 'ClosureError';
  }
}

/**
 * The rules about what can be closed: a real date, not in the past, not a
 * departure that's already left (marina time). The whole-day shortcut on
 * a day whose first trip has gone out has to name the ones still to go,
 * so a trip that's already happened is never refunded.
 */
export function assertClosable(date: string, slots: readonly string[], now: MarinaClock, affected: Booking[]): void {
  if (!isRealDate(date)) throw new ClosureError(`${date} isn’t a date on the calendar.`, 400);
  if (date < now.date) throw new ClosureError('That date has passed. Pick today or a day ahead.', 400);
  const named = slots.includes('all') ? REGULAR_SLOTS : (slots as TourTimeSlot[]);
  const gone = named.filter((s) => departureStarted(date, s, now));
  if (gone.length > 0) {
    throw new ClosureError(
      slots.includes('all')
        ? `The ${gone.map(departsDisplay).join(' and ')} ${gone.length === 1 ? 'trip has' : 'trips have'} already left today. Pick the trips still to go.`
        : `The ${gone.map(departsDisplay).join(' and ')} ${gone.length === 1 ? 'trip has' : 'trips have'} already left. Pick the trips still to go.`,
      400,
    );
  }
  const left = affected.find((b) => departureStarted(date, b.timeSlot, now));
  if (left) {
    throw new ClosureError(
      `${left.customerName || 'A booking'}’s ${left.timeSlot === 'whole-day' ? 'all-day charter' : 'trip'} already left at ${departsDisplay(left.timeSlot)}. Cancel it from its booking page if you need to.`,
      400,
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Preview                                                                    */
/* -------------------------------------------------------------------------- */

export type BookingOutcome =
  | { kind: 'offer'; decideBy: string }
  | {
      kind: 'cancel';
      /** Back to their card through Stripe. */
      refundCents: number;
      /** Paid on the old website: Travis refunds it himself. */
      manualRefundCents: number;
      /** A checkout still in progress: nothing was paid. */
      unpaidCheckout: boolean;
    }
  | { kind: 'keep' };

export interface PreviewBooking {
  id: string;
  customerName: string;
  timeSlot: TourTimeSlot;
  departs: string;
  tourName: string;
  guestCount: number;
  status: Booking['status'];
  owedCents: number;
  legacy: boolean;
  hasEmail: boolean;
  /** Already waiting on a new-date choice from an earlier closure. */
  alreadyOffered: boolean;
  outcomes: Record<ClosureChoice, BookingOutcome>;
}

export interface PreviewEmail {
  bookingId: string;
  to: string;
  subject: string;
  html: string;
}

export interface PreviewDeparture {
  slot: TourTimeSlot;
  departs: string;
  bookings: number;
  guests: number;
}

export interface ClosurePreview {
  date: string;
  affectedSlots: BlackoutSlot[];
  reason: BlackoutReason | null;
  /** Shown to customers, e.g. "Closed for weather". */
  customerReason: string;
  undoMinutes: number;
  decideBy: string;
  farAhead: boolean;
  departures: PreviewDeparture[];
  bookings: PreviewBooking[];
  guests: number;
  /** One per choice Travis can make. Only `keep` when nobody's booked. */
  choices: Partial<Record<ClosureChoice, { confirmToken: string; emails: PreviewEmail[] }>>;
  expiresAt: string;
}

export interface CloseDayDeps {
  db?: Firestore;
  now?: Date;
  baseUrl: string;
  audit?: (entry: { admin: AdminContext; action: AuditAction; targetId: string; payload?: Record<string, unknown> }) => Promise<void>;
}

async function undoMinutesSetting(db: Firestore, tx?: FirebaseFirestore.Transaction): Promise<number> {
  const ref = db.collection('settings').doc('site');
  const snap = tx ? await tx.get(ref) : await ref.get();
  const v = snap.exists ? (snap.data() as { closureUndoMinutes?: unknown }).closureUndoMinutes : undefined;
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= MAX_UNDO_MINUTES ? v : DEFAULT_UNDO_MINUTES;
}

/** What closing the day does to one booking under each choice. */
function outcomesFor(b: Booking, decideBy: string): Record<ClosureChoice, BookingOutcome> {
  const owed = owedCents(b);
  const legacy = isLegacyBooking(b);
  const refundCents = !legacy && b.stripePaymentIntentId ? owed : 0;
  const cancel: BookingOutcome = {
    kind: 'cancel',
    refundCents,
    manualRefundCents: owed - refundCents,
    unpaidCheckout: b.status === 'pending-payment' && !legacy,
  };
  return {
    // A checkout in progress has nothing to move; it's cancelled either way.
    offer: canOfferMove(b) ? { kind: 'offer', decideBy } : cancel,
    cancel,
    keep: { kind: 'keep' },
  };
}

/** The email each customer would get, from the same templates the send uses. */
function emailFor(b: Booking, outcome: BookingOutcome, reason: string, baseUrl: string): PreviewEmail | null {
  if (!b.customerEmail || outcome.kind === 'keep') return null;
  if (outcome.kind === 'offer') {
    const { subject, html } = buildClosureOfferEmail({
      booking: b,
      reason,
      decideBy: outcome.decideBy,
      baseUrl,
      phoneDisplay: PHONE_DISPLAY,
      marina: MARINA,
    });
    return { bookingId: b.id, to: b.customerEmail, subject, html };
  }
  // What adminCancelOne sends: the booking as it will be once cancelled.
  const { subject, html } = buildCancellationEmail({
    booking: { ...b, status: 'cancelled', cancellationReason: reason },
    refundCents: outcome.refundCents,
    refundPercent: 100,
    cancelledBy: 'admin',
    reason,
    marina: MARINA,
    phoneDisplay: PHONE_DISPLAY,
    manualRefundCents: outcome.manualRefundCents,
    previouslyRefundedCents: b.amountRefundedCents ?? 0,
  });
  return { bookingId: b.id, to: b.customerEmail, subject, html };
}

/** Refuses a second closure on a day that already has one waiting to send. */
async function assertNoPendingClosure(db: Firestore, date: string, tx?: FirebaseFirestore.Transaction): Promise<void> {
  const q = db.collection('closureActions').where('date', '==', date);
  const snap = tx ? await tx.get(q) : await q.get();
  const busy = snap.docs.some((d) => {
    const state = (d.data() as ClosureAction).state;
    return state === 'pending' || state === 'finalizing';
  });
  if (busy) {
    throw new ClosureError(
      'You’re already closing trips on that day. Undo it or tap Send now on the banner first.',
      409,
      'busy',
    );
  }
}

/**
 * What closing `slots` on `date` would do, with the exact emails, and a
 * confirm token for each choice. Sends nothing and changes no booking.
 */
export async function previewClosure(
  input: { date: string; affectedSlots: BlackoutSlot[]; reason?: BlackoutReason; notes?: string },
  admin: AdminContext,
  deps: CloseDayDeps,
): Promise<ClosurePreview> {
  const db = deps.db ?? defaultDb;
  const nowDate = deps.now ?? new Date();
  const now = marinaNow(nowDate);
  const slots = [...new Set(input.affectedSlots)].sort() as BlackoutSlot[];

  const [bookings, undoMinutes] = await Promise.all([
    affectedBookings(db, input.date, slots),
    undoMinutesSetting(db),
  ]);
  assertClosable(input.date, slots, now, bookings);
  await assertNoPendingClosure(db, input.date);

  const reason = customerReason(input.reason);
  const decideBy = closureDecideBy(input.date, now.date);
  const fingerprint = bookingsFingerprint(bookings);

  const departures = new Map<TourTimeSlot, PreviewDeparture>();
  const named = slots.includes('all') ? REGULAR_SLOTS : (slots.filter((s) => s !== 'all') as TourTimeSlot[]);
  for (const s of named) departures.set(s, { slot: s, departs: departsDisplay(s), bookings: 0, guests: 0 });
  for (const b of bookings) {
    const d = departures.get(b.timeSlot) ?? { slot: b.timeSlot, departs: departsDisplay(b.timeSlot), bookings: 0, guests: 0 };
    d.bookings += 1;
    d.guests += Math.max(0, b.guestCount);
    departures.set(b.timeSlot, d);
  }

  const rows: PreviewBooking[] = bookings.map((b) => ({
    id: b.id,
    customerName: b.customerName,
    timeSlot: b.timeSlot,
    departs: departsDisplay(b.timeSlot),
    tourName: b.tourName,
    guestCount: b.guestCount,
    status: b.status,
    owedCents: owedCents(b),
    legacy: isLegacyBooking(b),
    hasEmail: !!b.customerEmail,
    alreadyOffered: !!b.closure,
    outcomes: outcomesFor(b, decideBy),
  }));

  const choices: ClosureChoice[] = bookings.length > 0 ? ['offer', 'cancel', 'keep'] : ['keep'];
  const expiresAt = new Date(nowDate.getTime() + PREVIEW_TTL_MS);
  const result: ClosurePreview['choices'] = {};
  const previewIds: string[] = [];
  for (const choice of choices) {
    const token = randomBytes(32).toString('base64url');
    const id = sha256(token);
    previewIds.push(id);
    await db.collection('closurePreviews').doc(id).set({
      date: input.date,
      affectedSlots: slots,
      reason: input.reason ?? null,
      notes: input.notes ?? null,
      choice,
      fingerprint,
      decideBy,
      bookingIds: bookings.map((b) => b.id),
      summary: {
        bookings: bookings.length,
        guests: bookings.reduce((s, b) => s + Math.max(0, b.guestCount), 0),
        departs: [...new Set(bookings.map((b) => b.timeSlot))].map(departsDisplay),
      },
      adminUid: admin.uid,
      adminEmail: admin.email,
      createdAt: Timestamp.fromDate(nowDate),
      expiresAt: Timestamp.fromDate(expiresAt),
      usedAt: null,
      blackoutId: null,
    });
    const emails =
      choice === 'keep'
        ? []
        : bookings
            .map((b) => emailFor(b, outcomesFor(b, decideBy)[choice], reason, deps.baseUrl))
            .filter((e): e is PreviewEmail => !!e);
    result[choice] = { confirmToken: token, emails };
  }

  await (deps.audit ?? noAudit)({
    admin,
    action: 'closure.preview',
    targetId: `closure/${input.date}`,
    payload: {
      date: input.date,
      affectedSlots: slots,
      reason: input.reason ?? null,
      bookingIds: bookings.map((b) => b.id),
      fingerprint,
      previewIds,
    },
  });

  return {
    date: input.date,
    affectedSlots: slots,
    reason: input.reason ?? null,
    customerReason: reason,
    undoMinutes,
    decideBy,
    farAhead: input.date > addDaysIso(now.date, FAR_AHEAD_DAYS),
    departures: [...departures.values()].sort((a, b) => startMinutes(a.slot) - startMinutes(b.slot)),
    bookings: rows,
    guests: bookings.reduce((s, b) => s + Math.max(0, b.guestCount), 0),
    choices: result,
    expiresAt: expiresAt.toISOString(),
  };
}

function addDaysIso(date: string, n: number): string {
  const [y, mo, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y!, mo! - 1, d! + n)).toISOString().slice(0, 10);
}

async function noAudit(): Promise<void> {}

/* -------------------------------------------------------------------------- */
/* Confirm                                                                    */
/* -------------------------------------------------------------------------- */

interface StoredPreview {
  date: string;
  affectedSlots: BlackoutSlot[];
  reason: BlackoutReason | null;
  notes: string | null;
  choice: ClosureChoice;
  fingerprint: string;
  decideBy: string;
  bookingIds: string[];
  summary: ClosureAction['summary'];
  adminUid: string;
  adminEmail: string;
  expiresAt: FirebaseFirestore.Timestamp;
  usedAt: FirebaseFirestore.Timestamp | null;
  blackoutId: string | null;
}

export interface ConfirmOutcome {
  blackoutId: string;
  /** `pending`: blocked, waiting out the undo window. `done`: finished now. */
  state: 'pending' | 'done';
  finalizeAt: string | null;
  /** This token was already used; this is what it did then. */
  alreadyConfirmed?: boolean;
  result?: ClosureResult;
}

/**
 * Whether a confirmed closure waits out the undo window before acting.
 * With nobody booked there's nothing to send, so the blackout is all.
 * "Leave them booked" still waits: the crew are told when it goes through.
 */
function waitsForUndo(bookings: number, undoMinutes: number): boolean {
  return bookings > 0 && undoMinutes > 0;
}

/**
 * Travis tapping the red button. Refuses unless the token is from a
 * preview he made in the last half hour for exactly this choice, and
 * every affected booking is as it was in that preview. Then, in the same
 * transaction, closes the departures to new bookings and records the
 * pending action. Nothing is cancelled, refunded or emailed here unless
 * there's no undo window (none set, nobody booked, or "leave them booked").
 */
export async function confirmClosure(
  input: { confirmToken: string; choice: ClosureChoice; confirmText?: string },
  admin: AdminContext,
  deps: CloseDayDeps & FinalizeDeps,
): Promise<ConfirmOutcome> {
  const db = deps.db ?? defaultDb;
  const nowDate = deps.now ?? new Date();
  const now = marinaNow(nowDate);
  const previewRef = db.collection('closurePreviews').doc(sha256(input.confirmToken));

  const confirmed = await db.runTransaction(async (tx) => {
    const snap = await tx.get(previewRef);
    const preview = snap.exists ? (snap.data() as StoredPreview) : null;
    if (!preview || preview.choice !== input.choice || preview.adminUid !== admin.uid) {
      throw new ClosureError('That confirmation doesn’t match what you reviewed. Go back and review it again.', 403, 'stale');
    }
    if (preview.usedAt && preview.blackoutId) {
      return { blackoutId: preview.blackoutId, again: true as const, preview };
    }
    if (preview.expiresAt.toMillis() < nowDate.getTime()) {
      throw new ClosureError('You looked at this more than half an hour ago. Review it again to make sure nothing changed.', 409, 'expired');
    }
    if (preview.bookingIds.length > 0 && (input.confirmText ?? '').trim().toLowerCase() !== 'cancel') {
      throw new ClosureError('Type CANCEL to confirm.', 400);
    }

    const bookings = await affectedBookings(db, preview.date, preview.affectedSlots, tx);
    await assertNoPendingClosure(db, preview.date, tx);
    const undoMinutes = await undoMinutesSetting(db, tx);
    if (bookingsFingerprint(bookings) !== preview.fingerprint) {
      throw new ClosureError(
        'Something changed since you looked: a booking was made, changed or cancelled on those trips. Review it again before closing.',
        409,
        'stale',
      );
    }
    assertClosable(preview.date, preview.affectedSlots, now, bookings);

    const blackoutRef = db.collection('blackouts').doc();
    const waits = waitsForUndo(bookings.length, undoMinutes);
    const finalizeAt = Timestamp.fromMillis(nowDate.getTime() + (waits ? undoMinutes * 60_000 : 0));
    tx.create(blackoutRef, {
      date: preview.date,
      affectedSlots: preview.affectedSlots,
      reason: preview.reason,
      notes: preview.notes,
      createdAt: FieldValue.serverTimestamp(),
    });
    const action: Omit<ClosureAction, 'id'> = {
      blackoutId: blackoutRef.id,
      date: preview.date,
      affectedSlots: preview.affectedSlots,
      reason: preview.reason,
      notes: preview.notes,
      choice: preview.choice,
      state: 'pending',
      createdBy: admin.email,
      createdByUid: admin.uid,
      createdAt: Timestamp.fromDate(nowDate),
      undoMinutes: waits ? undoMinutes : 0,
      finalizeAt,
      previewBookingIds: preview.bookingIds,
      previewFingerprint: preview.fingerprint,
      decideBy: preview.decideBy,
      summary: preview.summary,
    };
    tx.set(db.collection('closureActions').doc(blackoutRef.id), action);
    tx.update(previewRef, { usedAt: Timestamp.fromDate(nowDate), blackoutId: blackoutRef.id });
    return { blackoutId: blackoutRef.id, again: false as const, preview, waits, finalizeAt, bookings: bookings.length, undoMinutes };
  });

  if (confirmed.again) {
    // A second tap, or a retry after the connection dropped.
    const action = (await db.collection('closureActions').doc(confirmed.blackoutId).get()).data() as ClosureAction | undefined;
    if (action?.state === 'undone') {
      throw new ClosureError('You undid this one. Review it again if you still want to close the day.', 409, 'stale');
    }
    return {
      blackoutId: confirmed.blackoutId,
      state: action?.state === 'done' ? 'done' : 'pending',
      finalizeAt: action?.finalizeAt ? new Date(action.finalizeAt.toMillis()).toISOString() : null,
      alreadyConfirmed: true,
      result: action?.result,
    };
  }

  await (deps.audit ?? noAudit)({
    admin,
    action: 'closure.confirm',
    targetId: confirmed.blackoutId,
    payload: {
      date: confirmed.preview.date,
      affectedSlots: confirmed.preview.affectedSlots,
      reason: confirmed.preview.reason,
      choice: confirmed.preview.choice,
      bookingIds: confirmed.preview.bookingIds,
      fingerprint: confirmed.preview.fingerprint,
      undoMinutes: confirmed.waits ? confirmed.undoMinutes : 0,
      finalizeAt: new Date(confirmed.finalizeAt.toMillis()).toISOString(),
    },
  });

  if (confirmed.waits) {
    return {
      blackoutId: confirmed.blackoutId,
      state: 'pending',
      finalizeAt: new Date(confirmed.finalizeAt.toMillis()).toISOString(),
    };
  }
  // No window: do it now, the same way the scheduler would.
  const done = await finalizeClosure(confirmed.blackoutId, 'immediate', deps, admin);
  return {
    blackoutId: confirmed.blackoutId,
    state: (done.kind === 'finalized' && !done.retrying) || done.kind === 'already-done' ? 'done' : 'pending',
    finalizeAt: null,
    result: done.kind === 'finalized' || done.kind === 'already-done' ? done.result : undefined,
  };
}

/* -------------------------------------------------------------------------- */
/* Undo                                                                       */
/* -------------------------------------------------------------------------- */

export type UndoOutcome =
  | { kind: 'undone'; action: ClosureAction }
  /** Already sending or sent: too late to undo. */
  | { kind: 'too-late'; state: ClosureAction['state'] }
  | { kind: 'already-undone' }
  | { kind: 'not-found' };

/**
 * Takes back a closure still in its undo window: the blackout goes, the
 * action is marked undone, and since nothing was sent or changed, that's
 * all. Loses to a finalize that claimed the action first.
 */
export async function undoClosure(
  blackoutId: string,
  admin: AdminContext,
  deps: Pick<CloseDayDeps, 'db' | 'now' | 'audit'>,
  how: 'undo' | 'reopen' = 'undo',
): Promise<UndoOutcome> {
  const db = deps.db ?? defaultDb;
  const nowDate = deps.now ?? new Date();
  const ref = db.collection('closureActions').doc(blackoutId);
  const outcome = await db.runTransaction(async (tx): Promise<UndoOutcome> => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { kind: 'not-found' };
    const action = { ...(snap.data() as ClosureAction), id: blackoutId };
    if (action.state === 'undone') return { kind: 'already-undone' };
    if (action.state !== 'pending') return { kind: 'too-late', state: action.state };
    tx.delete(db.collection('blackouts').doc(blackoutId));
    tx.update(ref, { state: 'undone', undoneAt: Timestamp.fromDate(nowDate), undoneBy: admin.email });
    return { kind: 'undone', action };
  });
  if (outcome.kind === 'undone') {
    await (deps.audit ?? noAudit)({
      admin,
      action: 'closure.undo',
      targetId: blackoutId,
      payload: {
        date: outcome.action.date,
        affectedSlots: outcome.action.affectedSlots,
        choice: outcome.action.choice,
        via: how,
        secondsBeforeSend: Math.max(0, Math.round((outcome.action.finalizeAt.toMillis() - nowDate.getTime()) / 1000)),
      },
    });
  }
  return outcome;
}

/* -------------------------------------------------------------------------- */
/* Finalize                                                                   */
/* -------------------------------------------------------------------------- */

export interface FinalizeDeps {
  db?: Firestore;
  now?: Date;
  baseUrl: string;
  stripe: Pick<Stripe, 'checkout' | 'refunds'>;
  /** Customer emails. bcc and reply-to go to `adminEmail`. */
  mailer: (adminEmail: string) => CancellationMailer;
  crew: CrewAlertSender;
  audit?: CloseDayDeps['audit'];
}

export interface CrewAlertSender {
  push(msg: { title: string; body: string; url: string; tag: string }): Promise<unknown>;
  email(msg: { to: string; subject: string; html: string; text: string; idempotencyKey: string }): Promise<void>;
}

export type FinalizeOutcome =
  /** `retrying`: a booking paid for mid-cancel is tried again in a couple of minutes. */
  | { kind: 'finalized'; result: ClosureResult; retrying?: boolean }
  | { kind: 'already-done'; result: ClosureResult }
  /** Undone, or the blackout was removed. */
  | { kind: 'undone' }
  /** Someone else is finalizing it right now. */
  | { kind: 'busy' }
  /** The scheduler came early. */
  | { kind: 'not-due' }
  | { kind: 'not-found' };

/**
 * Runs a confirmed closure: claims it in a transaction (only one of Send
 * now, the scheduler and a retry gets it), re-reads the bookings on the
 * day, and does what Travis chose. Bookings made or paid during the undo
 * window are included; ones cancelled or moved meanwhile are skipped.
 * Then the crew are told once, and the action is marked done.
 */
export async function finalizeClosure(
  blackoutId: string,
  by: 'scheduler' | 'send-now' | 'immediate',
  deps: FinalizeDeps,
  admin?: AdminContext,
): Promise<FinalizeOutcome> {
  const db = deps.db ?? defaultDb;
  const nowDate = deps.now ?? new Date();
  const ref = db.collection('closureActions').doc(blackoutId);
  const blackoutRef = db.collection('blackouts').doc(blackoutId);

  const claim = await db.runTransaction(async (tx) => {
    const [snap, blackout] = await Promise.all([tx.get(ref), tx.get(blackoutRef)]);
    if (!snap.exists) return { kind: 'not-found' as const };
    const action = { ...(snap.data() as ClosureAction), id: blackoutId };
    if (action.state === 'done') return { kind: 'already-done' as const, action };
    if (action.state === 'undone') return { kind: 'undone' as const };
    if (action.state === 'finalizing') {
      // Still being run, unless it's waiting to retry a booking that was
      // paid for mid-cancel, or that run died long ago.
      const claimed = action.claimedAt?.toMillis() ?? 0;
      const retryDue = !!action.retryAt && action.retryAt.toMillis() <= nowDate.getTime();
      if (by !== 'scheduler' || !(retryDue || nowDate.getTime() - claimed >= FINALIZE_LEASE_MS)) {
        return { kind: 'busy' as const };
      }
    } else if (by === 'scheduler' && action.finalizeAt.toMillis() > nowDate.getTime()) {
      return { kind: 'not-due' as const };
    }
    if (!blackout.exists) {
      // Reopened some other way while it waited: nothing was sent.
      tx.update(ref, { state: 'undone', undoneAt: Timestamp.fromDate(nowDate), undoneBy: 'blackout removed' });
      return { kind: 'undone' as const };
    }
    tx.update(ref, {
      state: 'finalizing',
      claimedAt: Timestamp.fromDate(nowDate),
      claimedBy: by,
      claims: (action.claims ?? 0) + 1,
      retryAt: FieldValue.delete(),
    });
    return { kind: 'claimed' as const, action };
  });

  if (claim.kind === 'already-done') return { kind: 'already-done', result: claim.action.result ?? emptyResult() };
  if (claim.kind !== 'claimed') return claim;
  const action = claim.action;

  let result: ClosureResult = emptyResult();
  if (action.choice === 'keep') {
    const left = await affectedBookings(db, action.date, action.affectedSlots);
    result.kept = left.map((b) => ({ id: b.id, customerName: b.customerName, timeSlot: b.timeSlot, guests: Math.max(0, b.guestCount) }));
  } else {
    result = await runClosureCascade(
      {
        blackoutId,
        date: action.date,
        slots: action.affectedSlots,
        reason: action.reason,
        choice: action.choice,
        decideBy: action.decideBy,
      },
      {
        db,
        now: nowDate,
        baseUrl: deps.baseUrl,
        stripe: deps.stripe,
        mailer: deps.mailer(action.createdBy),
      },
    );
    // A run after a retry only sees what's still to do.
    if (action.result) result = mergeResults(action.result, result);
  }

  // Someone finished paying as we tried to cancel them: Stripe's
  // confirmation lands within moments, so try them again shortly, and only
  // tell the crew once the list is complete.
  const retries = action.retries ?? 0;
  if (result.failed.some((f) => f.retryable) && retries < MAX_PAID_MEANWHILE_RETRIES) {
    await ref.update({
      result,
      retries: retries + 1,
      retryAt: Timestamp.fromMillis(nowDate.getTime() + PAID_MEANWHILE_RETRY_MS),
    });
    return { kind: 'finalized', result, retrying: true };
  }

  try {
    await alertCrewOnce(blackoutId, action, result, { db, crew: deps.crew, now: nowDate, baseUrl: deps.baseUrl });
  } catch (err) {
    logger.error('Crew closure alert failed', { blackoutId, err });
  }

  await ref.update({
    state: 'done',
    finalizedAt: Timestamp.fromDate(nowDate),
    finalizedBy: by,
    result,
  });

  await (deps.audit ?? noAudit)({
    admin: admin ?? { uid: 'scheduler', email: action.createdBy, via: 'scheduler' },
    action: 'closure.finalize',
    targetId: blackoutId,
    payload: {
      date: action.date,
      affectedSlots: action.affectedSlots,
      reason: action.reason,
      choice: action.choice,
      by,
      cancelledBookingIds: result.cancelled.map((c) => c.id),
      offeredBookingIds: result.offered.map((o) => o.id),
      failedBookingIds: result.failed.map((f) => f.id),
    },
  });

  return { kind: 'finalized', result };
}

function emptyResult(): ClosureResult {
  return { cancelled: [], offered: [], failed: [] };
}

/** Runs before and after a retry, as one result. The later run's failures stand. */
function mergeResults(before: ClosureResult, after: ClosureResult): ClosureResult {
  const byId = <T extends { id: string }>(a: T[], b: T[]) => [...new Map([...a, ...b].map((x) => [x.id, x])).values()];
  return {
    cancelled: byId(before.cancelled, after.cancelled),
    offered: byId(before.offered, after.offered),
    failed: after.failed,
  };
}

/** How often, and how soon, a booking paid for mid-cancel is tried again. */
export const MAX_PAID_MEANWHILE_RETRIES = 3;
export const PAID_MEANWHILE_RETRY_MS = 2 * 60 * 1000;

/** Actions due now, and ones whose finalize died, for the scheduler. */
export async function finalizeDueClosures(deps: FinalizeDeps): Promise<{ finalized: string[]; failed: string[] }> {
  const db = deps.db ?? defaultDb;
  const nowMs = (deps.now ?? new Date()).getTime();
  const [pending, stuck] = await Promise.all([
    db.collection('closureActions').where('state', '==', 'pending').get(),
    db.collection('closureActions').where('state', '==', 'finalizing').get(),
  ]);
  const due = [
    ...pending.docs.filter((d) => (d.data() as ClosureAction).finalizeAt.toMillis() <= nowMs),
    ...stuck.docs.filter((d) => {
      const a = d.data() as ClosureAction;
      return (!!a.retryAt && a.retryAt.toMillis() <= nowMs) || nowMs - (a.claimedAt?.toMillis() ?? 0) >= FINALIZE_LEASE_MS;
    }),
  ];
  const out = { finalized: [] as string[], failed: [] as string[] };
  for (const doc of due) {
    try {
      const r = await finalizeClosure(doc.id, 'scheduler', deps);
      if (r.kind === 'finalized') out.finalized.push(doc.id);
    } catch (err) {
      logger.error('Finalizing a closure failed; the next run retries it', { blackoutId: doc.id, err });
      out.failed.push(doc.id);
    }
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* The cascade (PR #28's close-a-day, moved here from adminBlackouts.ts)      */
/* -------------------------------------------------------------------------- */

/**
 * Does what Travis chose to every active booking on `date` in the closed
 * slots (every slot if `'all'` is included). A whole-day charter runs
 * through the morning, mid-morning and early-afternoon departures, so
 * closing any of those catches it too.
 *
 * `cancel`: each booking goes through adminCancelOne: Stripe refunds where
 * this site took the money, a note to refund by hand where the old site did.
 *
 * `offer`: the bookings stay on and each customer is emailed to pick
 * another date or a full refund instead. Checkouts still in progress are
 * cancelled either way: nothing's been paid.
 *
 * One failure doesn't stop the rest; failures are reported back. Safe to
 * run again for the same blackout: a booking already offered by it isn't
 * emailed twice, and a cancelled one isn't refunded twice.
 */
export async function runClosureCascade(
  opts: {
    blackoutId: string;
    date: string;
    slots: readonly string[];
    reason: string | null | undefined;
    choice: Exclude<ClosureChoice, 'keep'>;
    /** Fixed when Travis confirmed; worked out from today if not given. */
    decideBy?: string;
  },
  deps: {
    db?: Firestore;
    now?: Date;
    baseUrl: string;
    stripe: Pick<Stripe, 'checkout' | 'refunds'>;
    mailer: CancellationMailer;
  },
): Promise<ClosureResult> {
  const db = deps.db ?? defaultDb;
  const targets = await affectedBookings(db, opts.date, opts.slots);
  const reason = customerReason(opts.reason);
  const decideBy = opts.decideBy ?? closureDecideBy(opts.date, marinaNow(deps.now).date);

  const result: ClosureResult = emptyResult();
  for (const booking of targets) {
    const guests = Math.max(0, booking.guestCount);
    if (opts.choice === 'offer' && canOfferMove(booking)) {
      try {
        const sameClosure = booking.closure?.blackoutId === opts.blackoutId;
        if (sameClosure && booking.closure?.offerEmailedAt) {
          // A repeated run: this one was offered and emailed already.
          result.offered.push({ id: booking.id, customerName: booking.customerName, timeSlot: booking.timeSlot, guests, decideBy: booking.closure.decideBy, emailed: true });
          continue;
        }
        const closure = sameClosure ? { blackoutId: opts.blackoutId, reason: booking.closure!.reason, decideBy: booking.closure!.decideBy } : { blackoutId: opts.blackoutId, reason, decideBy };
        const marked = sameClosure ? booking : await markClosed(booking.id, closure, { db });
        if (!marked) continue; // cancelled or finished since we looked
        let emailed = false;
        if (marked.customerEmail) {
          try {
            const { subject, html, text } = buildClosureOfferEmail({
              booking: marked,
              reason: closure.reason,
              decideBy: closure.decideBy,
              baseUrl: deps.baseUrl,
              phoneDisplay: PHONE_DISPLAY,
              marina: MARINA,
            });
            await deps.mailer.send({
              to: marked.customerEmail,
              subject,
              html,
              text,
              bookingId: booking.id,
              idempotencyKey: `closure-offer/${booking.id}/${opts.blackoutId}`,
            });
            emailed = true;
            await markClosureField(db, booking.id, opts.blackoutId, 'offerEmailedAt', deps.now);
          } catch (err) {
            logger.error('Closure offer email failed', { bookingId: booking.id, err });
          }
        }
        result.offered.push({ id: booking.id, customerName: booking.customerName, timeSlot: booking.timeSlot, guests, decideBy: closure.decideBy, emailed });
      } catch (err) {
        logger.error('Closure offer failed', { bookingId: booking.id, err });
        result.failed.push({ id: booking.id, customerName: booking.customerName, error: 'Couldn’t offer a new date. Open the booking and sort it out there.' });
      }
      continue;
    }
    try {
      const outcome = await adminCancelOne(
        booking.id,
        { reason, notifyCustomer: true, cause: 'blackout' },
        { stripe: deps.stripe, mailer: deps.mailer, db },
      );
      if (outcome.kind === 'cancelled') {
        result.cancelled.push({
          id: booking.id,
          customerName: booking.customerName,
          timeSlot: booking.timeSlot,
          guests,
          refundCents: outcome.refundCents,
          manualRefundCents: outcome.manualRefundCents,
          emailed: outcome.emailed,
          unpaidCheckout: booking.status === 'pending-payment' && !isLegacyBooking(booking),
        });
      } else if (outcome.kind === 'paid-meanwhile') {
        // Stripe's confirmation lands in a moment; finalizeClosure tries
        // this one again once it has.
        result.failed.push({
          id: booking.id,
          customerName: booking.customerName,
          error: 'They paid just as the day was closed. It’s being tried again in a couple of minutes; if it’s still here, open the booking and sort it out there.',
          retryable: true,
        });
      } else if (outcome.kind !== 'already-cancelled') {
        result.failed.push({ id: booking.id, customerName: booking.customerName, error: outcome.kind });
      }
    } catch (err) {
      logger.error('Blackout cancellation failed', { bookingId: booking.id, err });
      result.failed.push({ id: booking.id, customerName: booking.customerName, error: 'Couldn’t cancel. Open the booking and cancel it there.' });
    }
  }
  return result;
}

/**
 * Stamps `closure.<field>` on a booking, but only while it's still waiting
 * on the same closure: a customer who moved in the meantime has no closure
 * left to stamp, and it mustn't come back.
 */
export async function markClosureField(
  db: Firestore,
  bookingId: string,
  blackoutId: string,
  field: 'offerEmailedAt' | 'reminderSentAt',
  now: Date = new Date(),
): Promise<boolean> {
  const ref = db.collection('bookings').doc(bookingId);
  return db.runTransaction(async (tx) => {
    const fresh = (await tx.get(ref)).data() as Booking | undefined;
    if (!fresh?.closure || fresh.closure.blackoutId !== blackoutId) return false;
    tx.update(ref, { closure: { ...fresh.closure, [field]: Timestamp.fromDate(now) } });
    return true;
  });
}

/* -------------------------------------------------------------------------- */
/* Crew alert                                                                 */
/* -------------------------------------------------------------------------- */

/** "Sat Oct 17" */
export function crewDate(date: string): string {
  const [y = 0, m = 1, d = 1] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d))
    .toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
    .replace(/,/g, '');
}

/** "8:00", or "7:00 all-day" for the charter. */
function crewTime(slot: TourTimeSlot): string {
  const short = departsDisplay(slot).replace(/ [AP]M$/, '');
  return slot === 'whole-day' ? `${short} all-day` : short;
}

function joinWords(words: string[]): string {
  if (words.length <= 1) return words[0] ?? '';
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

/**
 * Push and email to every crew member about the trips that were called
 * off, once per closure: the marker is claimed in a transaction before
 * anything goes out, so a second finalize (or a retry after a crash)
 * doesn't send it again. A closure that called nothing off (nobody was
 * booked, or Travis left them booked) sends nothing.
 */
export async function alertCrewOnce(
  blackoutId: string,
  action: Pick<ClosureAction, 'date' | 'reason' | 'choice'>,
  result: ClosureResult,
  deps: { db: Firestore; crew: CrewAlertSender; now?: Date; baseUrl: string },
): Promise<{ sent: boolean }> {
  const calledOff = [...result.cancelled.filter((c) => !c.unpaidCheckout), ...result.offered, ...(result.kept ?? [])];
  if (calledOff.length === 0) return { sent: false };
  const ref = deps.db.collection('closureActions').doc(blackoutId);
  const claimed = await deps.db.runTransaction(async (tx) => {
    const fresh = (await tx.get(ref)).data() as ClosureAction | undefined;
    if (!fresh || fresh.crewAlert?.claimedAt) return false;
    tx.update(ref, { crewAlert: { claimedAt: Timestamp.fromDate(deps.now ?? new Date()) } });
    return true;
  });
  if (!claimed) return { sent: false };

  const slots = [...new Set(calledOff.map((c) => c.timeSlot))].sort((a, b) => startMinutes(a) - startMinutes(b));
  const guests = calledOff.reduce((s, c) => s + c.guests, 0);
  const label = action.choice === 'keep' ? 'Closed' : action.reason === 'weather' ? 'Weather cancel' : 'Trips cancelled';
  const when = joinWords(slots.map(crewTime));
  const guestText = `${guests} ${guests === 1 ? 'guest' : 'guests'}`;
  const subject = `[CRMF] ${label}: ${crewDate(action.date)}, ${when} (${guestText})`;

  let pushed = false;
  try {
    await deps.crew.push({
      title: `${label}: ${crewDate(action.date)}`,
      body:
        action.choice === 'keep'
          ? `${when} closed · ${guestText} booked, Travis is contacting them`
          : `${when} ${slots.length === 1 ? 'is' : 'are'} off · ${guestText}`,
      url: '/crew',
      tag: `closure-${blackoutId}`,
    });
    pushed = true;
  } catch (err) {
    logger.error('Crew closure push failed', { blackoutId, err });
  }

  const crewSnap = await deps.db.collection('crew').get();
  const { html, text } = buildCrewClosureAlertEmail({
    subject,
    date: action.date,
    reason: customerReason(action.reason),
    choice: action.choice,
    departures: slots.map((slot) => ({
      departs: departsDisplay(slot),
      slot,
      guests: calledOff.filter((c) => c.timeSlot === slot).reduce((s, c) => s + c.guests, 0),
    })),
    crewUrl: `${deps.baseUrl}/crew`,
  });
  const emailed: string[] = [];
  const failed: string[] = [];
  for (const doc of crewSnap.docs) {
    const email = (doc.data() as { email?: string }).email;
    if (!email) continue;
    try {
      await deps.crew.email({ to: email, subject, html, text, idempotencyKey: `crew-closure/${blackoutId}/${doc.id}` });
      emailed.push(doc.id);
    } catch (err) {
      logger.error('Crew closure email failed', { blackoutId, crewId: doc.id, err });
      failed.push(doc.id);
    }
  }
  await ref.update({
    crewAlert: {
      claimedAt: Timestamp.fromDate(deps.now ?? new Date()),
      sentAt: Timestamp.fromDate(deps.now ?? new Date()),
      subject,
      pushed,
      emailedCrewIds: emailed,
      failedCrewIds: failed,
    },
  });
  return { sent: true };
}

import { createHash, randomBytes } from 'node:crypto';
import { logger } from 'firebase-functions/v2';
import type { Firestore } from 'firebase-admin/firestore';
import type Stripe from 'stripe';

import { db as defaultDb, FieldValue, Timestamp } from './firebase';
import { adminCancelOne, type CancellationMailer } from './admin-cancel';
import type { AdminContext } from './admin-auth';
import { WHOLE_DAY_OVERLAPS } from './availability';
import { awaitingMove, canOfferMove, closureDecideBy, markClosed } from './closure';
import { isRealDate, marinaNow, type MarinaClock } from './datetime';
import {
  buildCancellationEmail,
  buildClosureOfferEmail,
  buildClosureSummaryEmail,
  buildCrewClosureAlertEmail,
  buildCrewReopenAlertEmail,
} from './email-templates';
import { SLOT_MINUTES, slotStartMinutes } from './schedule';
import { formatPrice } from './tours';
import {
  isLegacyBooking,
  type AuditAction,
  type Blackout,
  type BlackoutReason,
  type BlackoutSlot,
  type Booking,
  type ClosureAction,
  type ClosureChoice,
  type ClosureProgressEntry,
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

/** Minutes after midnight the departure leaves on `date`, marina time (the sunset cruise's moves with the sun). */
function startMinutes(slot: TourTimeSlot, date: string): number {
  return slot in SLOT_MINUTES ? slotStartMinutes(slot, date) : 0;
}

/** Left already (or the date is past), marina time. */
export function departureStarted(date: string, slot: TourTimeSlot, now: MarinaClock): boolean {
  if (date < now.date) return true;
  if (date > now.date) return false;
  return now.minutes >= startMinutes(slot, date);
}

/** "8:00 AM" */
export function departsDisplay(slot: TourTimeSlot, date: string): string {
  const mins = startMinutes(slot, date);
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
    .sort((a, b) => startMinutes(a.timeSlot, a.date) - startMinutes(b.timeSlot, b.date) || a.id.localeCompare(b.id));
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
        ? `The ${gone.map((s) => departsDisplay(s, date)).join(' and ')} ${gone.length === 1 ? 'trip has' : 'trips have'} already left today. Pick the trips still to go.`
        : `The ${gone.map((s) => departsDisplay(s, date)).join(' and ')} ${gone.length === 1 ? 'trip has' : 'trips have'} already left. Pick the trips still to go.`,
      400,
    );
  }
  const left = affected.find((b) => departureStarted(date, b.timeSlot, now));
  if (left) {
    throw new ClosureError(
      `${left.customerName || 'A booking'}’s ${left.timeSlot === 'whole-day' ? 'all-day charter' : 'trip'} already left at ${departsDisplay(left.timeSlot, date)}. Cancel it from its booking page if you need to.`,
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
  for (const s of named) departures.set(s, { slot: s, departs: departsDisplay(s, input.date), bookings: 0, guests: 0 });
  for (const b of bookings) {
    const d = departures.get(b.timeSlot) ?? { slot: b.timeSlot, departs: departsDisplay(b.timeSlot, b.date), bookings: 0, guests: 0 };
    d.bookings += 1;
    d.guests += Math.max(0, b.guestCount);
    departures.set(b.timeSlot, d);
  }

  const rows: PreviewBooking[] = bookings.map((b) => ({
    id: b.id,
    customerName: b.customerName,
    timeSlot: b.timeSlot,
    departs: departsDisplay(b.timeSlot, b.date),
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
  // One token per choice. Each preview knows the others from the same
  // review, so confirming one retires the rest (an Undo then needs a new
  // review, not another choice from the old one).
  const tokens = new Map(choices.map((choice) => [choice, randomBytes(32).toString('base64url')] as const));
  const previewIds = choices.map((choice) => sha256(tokens.get(choice)!));
  for (const choice of choices) {
    const token = tokens.get(choice)!;
    const id = sha256(token);
    await db.collection('closurePreviews').doc(id).set({
      siblingIds: previewIds.filter((other) => other !== id),
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
        departs: [...new Map(bookings.map((b) => [b.timeSlot, departsDisplay(b.timeSlot, b.date)])).values()],
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
    departures: [...departures.values()].sort((a, b) => startMinutes(a.slot, input.date) - startMinutes(b.slot, input.date)),
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
  /** The other choices' previews from the same review. */
  siblingIds?: string[];
  /** Another choice from the same review was confirmed: this one can't be. */
  supersededAt?: FirebaseFirestore.Timestamp | null;
}

export interface ConfirmOutcome {
  blackoutId: string;
  /**
   * `pending`: blocked, waiting out the undo window (`finalizeAt` set), or
   * going out now with a booking still being retried (`finalizeAt` null).
   * `done`: finished.
   */
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
    if (preview.supersededAt) {
      throw new ClosureError('You already went ahead with a different choice from this review. Review it again.', 409, 'stale');
    }
    const siblingRefs = (preview.siblingIds ?? []).map((id) => db.collection('closurePreviews').doc(id));
    for (const sib of siblingRefs) await tx.get(sib);
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
      stampsCancels: true,
      decideBy: preview.decideBy,
      summary: preview.summary,
    };
    tx.set(db.collection('closureActions').doc(blackoutRef.id), action);
    tx.update(previewRef, { usedAt: Timestamp.fromDate(nowDate), blackoutId: blackoutRef.id });
    for (const sib of siblingRefs) tx.set(sib, { supersededAt: Timestamp.fromDate(nowDate) }, { merge: true });
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
      // Only while it can still be undone: once it's going out, the page
      // mustn't say nothing has been sent.
      finalizeAt:
        action?.state === 'pending' && action.finalizeAt ? new Date(action.finalizeAt.toMillis()).toISOString() : null,
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
  /** `restored`: put back on their trips (see undoClosure). */
  | { kind: 'undone'; action: ClosureAction; restored: RestoredBooking[] }
  /** Already sending or sent: too late to undo. */
  | { kind: 'too-late'; state: ClosureAction['state'] }
  | { kind: 'already-undone' }
  | { kind: 'not-found' };

/**
 * Takes back a closure still in its undo window: the blackout goes, the
 * action is marked undone, and since nothing was sent or changed, that's
 * all, with one exception. An earlier closure of the same trips that was
 * reopened while this one covered them left its bookings waiting on a new
 * date (restoreOfferedBookings skips a trip another closed day covers).
 * With this one gone too, nothing holds them off their trips, so they go
 * back on in the same transaction, recorded as `restoredBookingIds` like
 * a reopen's, with the same full-refund grace from that earlier offer
 * (putBackFields). Loses to a finalize that claimed the action first.
 */
export async function undoClosure(
  blackoutId: string,
  admin: AdminContext,
  deps: Pick<CloseDayDeps, 'db' | 'now' | 'audit'>,
  how: 'undo' | 'reopen' = 'undo',
): Promise<UndoOutcome> {
  const db = deps.db ?? defaultDb;
  const nowDate = deps.now ?? new Date();
  const now = marinaNow(nowDate);
  const ref = db.collection('closureActions').doc(blackoutId);
  const outcome = await db.runTransaction(async (tx): Promise<UndoOutcome> => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { kind: 'not-found' };
    const action = { ...(snap.data() as ClosureAction), id: blackoutId };
    if (action.state === 'undone') return { kind: 'already-undone' };
    if (action.state !== 'pending') return { kind: 'too-late', state: action.state };
    const [onDay, blackouts] = await Promise.all([
      tx.get(db.collection('bookings').where('date', '==', action.date)),
      tx.get(db.collection('blackouts').where('date', '==', action.date)),
    ]);
    const back = onDay.docs
      .map((d) => ({ ...(d.data() as Booking), id: d.id }))
      .filter((b) => closesSlot(action.affectedSlots, b.timeSlot) && canPutBack(b, blackoutId, blackouts.docs, now));
    tx.delete(db.collection('blackouts').doc(blackoutId));
    tx.update(ref, {
      state: 'undone',
      undoneAt: Timestamp.fromDate(nowDate),
      undoneBy: admin.email,
      ...(back.length > 0 && { restoredBookingIds: back.map((b) => b.id) }),
    });
    for (const b of back) tx.update(db.collection('bookings').doc(b.id), putBackFields(b, now));
    return { kind: 'undone', action, restored: back.map((b) => restoredBooking(b.id, b)) };
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
        ...(outcome.restored.length > 0 && { restoredBookingIds: outcome.restored.map((r) => r.id) }),
      },
    });
  }
  return outcome;
}

/* -------------------------------------------------------------------------- */
/* Reopen                                                                     */
/* -------------------------------------------------------------------------- */

export interface RestoredBooking {
  id: string;
  customerName: string;
  date: string;
  timeSlot: TourTimeSlot;
  /** 0 when the old site didn't record the party size. */
  guests: number;
}

/**
 * Reopening a day after its closure went out. Anyone it offered a new date
 * who hasn't moved or taken the refund goes back on their original trip,
 * as if it had never closed: settleClosedBookings doesn't refund them, the
 * crew and the dashboard count them, and they get the day-before reminders
 * if those haven't gone out yet (3 PM the day before for waivers, 5 PM for
 * the tour reminder). One thing stays from the offer: until its deadline
 * they can still cancel for a full refund (putBackFields). Not a trip that
 * has already left (they still have to choose), nor one another closed day
 * still covers (if that one is still in its undo window and is undone,
 * undoClosure puts them back).
 *
 * A later closure of the same trip (the morning, then the whole day)
 * offers its bookings again under its own id. So this also takes back
 * bookings on the departures it covers that are waiting on a closure
 * reopened already, whichever order Travis reopens the two in.
 *
 * Each booking changes in its own transaction, only while it's still
 * waiting, so a customer moving or taking the refund at the same moment
 * wins, and running it again changes nothing. adminDeleteBlackout runs it
 * before removing the blackout: one that fails partway leaves the day
 * closed, to reopen again. Each booking put back is also recorded on the
 * closure (`restoredBookingIds`, in the same transaction), and the list
 * returned includes those, so the retry still lists everyone the first
 * try put back (the query no longer finds them). Nobody is emailed;
 * Travis gets the list.
 *
 * Before anything else the closure is stamped `reopenedAt`: anyone this
 * leaves waiting on a new date is waiting on purpose, not left behind the
 * way the old version of the site's reopen left everyone (isStaleClosure).
 */
export async function restoreOfferedBookings(
  blackoutId: string,
  deps: { db?: Firestore; now?: Date } = {},
): Promise<RestoredBooking[]> {
  const db = deps.db ?? defaultDb;
  const now = marinaNow(deps.now);
  const actionRef = db.collection('closureActions').doc(blackoutId);
  const [blackoutSnap, actionSnap] = await Promise.all([db.collection('blackouts').doc(blackoutId).get(), actionRef.get()]);
  const blackout = blackoutSnap.data() as Blackout | undefined;
  if (actionSnap.exists && !(actionSnap.data() as ClosureAction).reopenedAt) {
    await actionRef.update({ reopenedAt: Timestamp.fromDate(deps.now ?? new Date()) });
  }
  // A day closed from MCP has no closure action, so nowhere to record them.
  const earlier = actionSnap.exists ? ((actionSnap.data() as ClosureAction).restoredBookingIds ?? []) : null;
  const [mine, onDay] = await Promise.all([
    db.collection('bookings').where('closure.blackoutId', '==', blackoutId).get(),
    blackout ? db.collection('bookings').where('date', '==', blackout.date).get() : null,
  ]);
  const ids = new Set([
    ...mine.docs.map((d) => d.id),
    ...(onDay?.docs ?? [])
      .filter((d) => {
        const b = d.data() as Booking;
        return !!b.closure && closesSlot(blackout!.affectedSlots, b.timeSlot);
      })
      .map((d) => d.id),
  ]);
  const restored: RestoredBooking[] = [];
  for (const id of ids) {
    const ref = db.collection('bookings').doc(id);
    const back = await db.runTransaction(async (tx): Promise<RestoredBooking | null> => {
      const fresh = (await tx.get(ref)).data() as Booking | undefined;
      if (!fresh?.closure || !awaitingMove(fresh)) return null;
      const onDate = await tx.get(db.collection('blackouts').where('date', '==', fresh.date));
      if (!canPutBack(fresh, blackoutId, onDate.docs, now)) return null;
      const recorded = earlier ? ((await tx.get(actionRef)).data() as ClosureAction | undefined)?.restoredBookingIds ?? [] : null;
      tx.update(ref, putBackFields(fresh, now));
      if (recorded && !recorded.includes(id)) tx.update(actionRef, { restoredBookingIds: [...recorded, id] });
      return restoredBooking(id, fresh);
    });
    if (back) restored.push(back);
  }

  // Put back by an earlier try that failed partway, and still on their trip.
  for (const id of earlier ?? []) {
    if (restored.some((r) => r.id === id)) continue;
    const b = (await db.collection('bookings').doc(id).get()).data() as Booking | undefined;
    if (b && isActive(b) && !b.closure) restored.push(restoredBooking(id, b));
  }
  return restored;
}

/**
 * Whether a booking waiting on a new date can go back on its trip: it's
 * still waiting, the trip hasn't left, and no closed day in `blackouts`
 * covers it other than `blackoutId`, the one coming down.
 */
function canPutBack(
  b: Booking,
  blackoutId: string,
  blackouts: ReadonlyArray<FirebaseFirestore.QueryDocumentSnapshot>,
  now: MarinaClock,
): boolean {
  if (!b.closure || !awaitingMove(b)) return false;
  if (departureStarted(b.date, b.timeSlot, now)) return false;
  // Another closed day still covers it, maybe the one its offer came from.
  return !blackouts.some((d) => d.id !== blackoutId && closesSlot((d.data() as Blackout).affectedSlots, b.timeSlot));
}

/**
 * The update that puts a booking back on its trip, with a note for Travis.
 * Both a reopen and an undo come through here.
 *
 * The offer they were sent promised a full refund until its deadline, so
 * that still stands (`refundGraceUntil`): cancelBooking refunds them in full
 * until then, whatever the 72-hour policy says. It's the deadline of the
 * offer on the booking, the one they were sent, not of a closure being
 * undone, which nobody was told about. Put back a second time, they keep
 * the later of the two.
 */
function putBackFields(b: Booking, now: MarinaClock): Record<string, unknown> {
  const decideBy = b.closure!.decideBy;
  const graceUntil = b.refundGraceUntil && b.refundGraceUntil > decideBy ? b.refundGraceUntil : decideBy;
  const note = `${now.date}: Back on this trip: you reopened the day after they were asked to pick a new date (${b.closure!.reason.toLowerCase()}). If they cancel by ${graceUntil}, they get a full refund, as the offer said.`;
  return {
    closure: FieldValue.delete(),
    refundGraceUntil: graceUntil,
    adminNotes: b.adminNotes ? `${b.adminNotes}\n${note}` : note,
    updatedAt: FieldValue.serverTimestamp(),
  };
}

function restoredBooking(id: string, b: Booking): RestoredBooking {
  return { id, customerName: b.customerName, date: b.date, timeSlot: b.timeSlot, guests: b.guestCount > 0 ? b.guestCount : 0 };
}

/**
 * Whether a booking's closure was left behind by a reopen, and so means
 * nothing any more. Reopening a day used to only take its blackout down:
 * everyone it had offered a new date stayed "choosing" while their trip
 * went ahead as normal, to be refunded at the deadline for a trip they may
 * have been on, with no way to mark it. A closure is stale when:
 *
 *  - nothing closes its trip any more: no blackout on the day covers it
 *    (its own came down, and no other closed day covers it either);
 *  - it isn't being sent right now (its action isn't pending or finalizing);
 *  - the reopen wasn't this version's (no `reopenedAt` on the action, see
 *    restoreOfferedBookings). That one puts back everyone whose trip is
 *    still to come, and leaves those whose trip had already left choosing
 *    on purpose: the trip didn't run.
 *
 * Nothing treats a stale closure as a closed trip: settleClosedBookings
 * never refunds one (clearStaleClosure), the closure reminder isn't sent,
 * and Travis can mark the trip completed or a no-show (lib/admin-mark.ts).
 */
export async function isStaleClosure(
  db: Firestore,
  b: Pick<Booking, 'closure' | 'date' | 'timeSlot'>,
  tx?: FirebaseFirestore.Transaction,
): Promise<boolean> {
  if (!b.closure) return false;
  const actionRef = db.collection('closureActions').doc(b.closure.blackoutId);
  const onDay = db.collection('blackouts').where('date', '==', b.date);
  const [actionSnap, blackouts] = await Promise.all([tx ? tx.get(actionRef) : actionRef.get(), tx ? tx.get(onDay) : onDay.get()]);
  if (blackouts.docs.some((d) => closesSlot((d.data() as Blackout).affectedSlots, b.timeSlot))) return false;
  const action = actionSnap.data() as ClosureAction | undefined;
  if (action?.state === 'pending' || action?.state === 'finalizing') return false;
  return !action?.reopenedAt;
}

/**
 * Takes a stale closure (isStaleClosure) off a booking, checking again in
 * the same transaction. A trip still to come goes back on, as a reopen
 * does it (putBackFields, with the offer's full refund until its
 * deadline). One that has left may have gone ahead, so nobody is refunded:
 * the closure comes off with a note for Travis to check whether they went
 * out. Null when there was nothing to take off. Nobody is emailed.
 */
export async function clearStaleClosure(
  bookingId: string,
  deps: { db?: Firestore; now?: Date } = {},
): Promise<'put-back' | 'cleared' | null> {
  const db = deps.db ?? defaultDb;
  const now = marinaNow(deps.now);
  const ref = db.collection('bookings').doc(bookingId);
  return db.runTransaction(async (tx) => {
    const fresh = (await tx.get(ref)).data() as Booking | undefined;
    if (!fresh || !awaitingMove(fresh) || !(await isStaleClosure(db, fresh, tx))) return null;
    if (!departureStarted(fresh.date, fresh.timeSlot, now)) {
      tx.update(ref, putBackFields(fresh, now));
      return 'put-back';
    }
    const note = `${now.date}: Not refunded: the day was reopened after they were asked to pick a new date (${fresh.closure!.reason.toLowerCase()}), so the trip may have gone ahead. Check whether they went out: mark the trip if they did, refund them if they didn’t.`;
    tx.update(ref, {
      closure: FieldValue.delete(),
      adminNotes: fresh.adminNotes ? `${fresh.adminNotes}\n${note}` : note,
      updatedAt: FieldValue.serverTimestamp(),
    });
    return 'cleared';
  });
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
  /**
   * Emails whoever closed the day (and Travis) what went out and what's
   * left for them to do, when nobody was watching the screen as it
   * finished: the scheduler ran it, or a crashed run was picked up.
   */
  notifyAdmin?: (msg: { to: string; subject: string; html: string; text: string; idempotencyKey: string }) => Promise<void>;
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
    // Who this closure is about, fixed the first time it runs, so a run
    // that dies partway can be picked up without losing anyone.
    const targetIds = action.targetIds ?? (await affectedBookings(db, action.date, action.affectedSlots, tx)).map((b) => b.id);
    tx.update(ref, {
      state: 'finalizing',
      claimedAt: Timestamp.fromDate(nowDate),
      claimedBy: by,
      claims: (action.claims ?? 0) + 1,
      retryAt: FieldValue.delete(),
      ...(action.targetIds ? {} : { targetIds }),
    });
    return { kind: 'claimed' as const, action: { ...action, targetIds } };
  });

  if (claim.kind === 'already-done') return { kind: 'already-done', result: claim.action.result ?? emptyResult() };
  if (claim.kind !== 'claimed') return claim;
  const action = claim.action;

  let result: ClosureResult = emptyResult();
  let recovered = 0;
  if (action.choice === 'keep') {
    const left = await affectedBookings(db, action.date, action.affectedSlots);
    result.kept = left.map((b) => ({ id: b.id, customerName: b.customerName, timeSlot: b.timeSlot, guests: Math.max(0, b.guestCount) }));
  } else {
    const run = await runClosureCascade(
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
        record: async (bookingId, progress) => {
          if (SAFE_ID.test(bookingId)) await ref.update({ [`progress.${bookingId}`]: progress });
        },
      },
    );
    // A rerun (after a retry, or after a run that died) only sees what's
    // still to do: what earlier runs did comes from the saved outcomes.
    result = combineOutcomes(action.result, action.progress, run);
    const found = await recoverCancelled(db, action, result);
    recovered = found.length;
    result.cancelled.push(...found);
  }

  // Someone finished paying as we tried to cancel them: Stripe's
  // confirmation lands within moments, so try them again shortly, and only
  // tell the crew once the list is complete.
  const retries = action.retries ?? 0;
  if (result.failed.some((f) => f.retryable)) {
    if (retries < MAX_PAID_MEANWHILE_RETRIES) {
      await ref.update({
        result,
        retries: retries + 1,
        retryAt: Timestamp.fromMillis(nowDate.getTime() + PAID_MEANWHILE_RETRY_MS),
      });
      return { kind: 'finalized', result, retrying: true };
    }
    // Out of retries: nothing is trying it again any more.
    result.failed = result.failed.map((f) =>
      f.retryable
        ? { ...f, retryable: false, error: 'They paid just as the day was closed, and it still couldn’t be cancelled. Open the booking and sort it out there.' }
        : f,
    );
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

  // Nobody was watching when it finished: tell whoever closed the day what
  // went out and what's left for them.
  if ((by === 'scheduler' || recovered > 0) && deps.notifyAdmin) {
    try {
      await summarizeForAdminOnce(blackoutId, action, result, { db, notifyAdmin: deps.notifyAdmin, now: nowDate, baseUrl: deps.baseUrl });
    } catch (err) {
      logger.error('Closure summary email failed', { blackoutId, err });
    }
  }

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

/** Booking ids as Firestore field-path segments: only plain ones. */
const SAFE_ID = /^[A-Za-z0-9_-]{1,200}$/;

/**
 * One result from every run of a closure: the result saved by an earlier
 * run (before a retry), the outcomes saved one by one (a run that died
 * partway), then this run. A booking appears once, as its latest outcome:
 * one that failed and then went through counts as gone through.
 */
export function combineOutcomes(
  saved: ClosureResult | undefined,
  progress: Record<string, ClosureProgressEntry> | undefined,
  run: ClosureResult,
): ClosureResult {
  const latest = new Map<string, ClosureProgressEntry>();
  const add = (r: ClosureResult | undefined) => {
    if (!r) return;
    for (const entry of r.cancelled ?? []) latest.set(entry.id, { bucket: 'cancelled', entry });
    for (const entry of r.offered ?? []) latest.set(entry.id, { bucket: 'offered', entry });
    for (const entry of r.failed ?? []) latest.set(entry.id, { bucket: 'failed', entry });
  };
  add(saved);
  for (const [id, p] of Object.entries(progress ?? {})) {
    if (p && p.entry) latest.set(id, p);
  }
  add(run);
  const out = emptyResult();
  for (const p of latest.values()) {
    if (p.bucket === 'cancelled') out.cancelled.push(p.entry);
    else if (p.bucket === 'offered') out.offered.push(p.entry);
    else out.failed.push(p.entry);
  }
  return out;
}

/**
 * Bookings this closure cancelled whose outcome was never saved: the run
 * died between cancelling one and writing it down. They're no longer
 * active, so a rerun skips them; without this they'd vanish from the
 * result, the crew alert and the crew app. Whether the customer was
 * emailed isn't known, so they're marked for Travis to check. Only
 * bookings carrying this closure's stamp count: Travis cancelling one by
 * hand meanwhile, or a checkout running out, isn't this closure's doing.
 *
 * A closure confirmed before cancels were stamped (no `stampsCancels`)
 * whose run died then, picked up by this version: its cancels carry no
 * stamp, so as that version did, any booking cancelled from admin since
 * the closure was confirmed counts.
 */
async function recoverCancelled(
  db: Firestore,
  action: ClosureAction,
  result: ClosureResult,
): Promise<ClosureResult['cancelled']> {
  const known = new Set([...result.cancelled, ...result.offered, ...result.failed].map((e) => e.id));
  const ids = [...new Set([...(action.targetIds ?? []), ...(action.previewBookingIds ?? [])])].filter(
    (id) => SAFE_ID.test(id) && !known.has(id),
  );
  if (ids.length === 0) return [];
  const since = millis(action.createdAt) ?? Infinity;
  const snaps = await Promise.all(ids.map((id) => db.collection('bookings').doc(id).get()));
  const found: ClosureResult['cancelled'] = [];
  for (const snap of snaps) {
    if (!snap.exists) continue;
    const b = { ...(snap.data() as Booking), id: snap.id };
    if (b.status !== 'cancelled') continue;
    const stamped = b.cancelledByClosure === action.blackoutId;
    const unstamped =
      !action.stampsCancels && !b.cancelledByClosure && b.cancelledBy === 'admin' && (millis(b.cancelledAt) ?? -Infinity) >= since;
    if (!stamped && !unstamped) continue;
    const legacy = isLegacyBooking(b);
    const paid = Math.max(0, b.amountPaidCents ?? 0);
    const refunded = Math.max(0, b.amountRefundedCents ?? 0);
    found.push({
      id: b.id,
      customerName: b.customerName,
      timeSlot: b.timeSlot,
      guests: Math.max(0, b.guestCount),
      // What the closure's cancel stamped alongside its id (lib/admin-cancel.ts),
      // not the booking's refunded total, which counts refunds before it.
      // Unstamped, there's only that total, and what's left of an old-site
      // payment is Travis's to refund.
      refundCents: stamped ? Math.max(0, b.closureRefundCents ?? 0) : legacy ? 0 : refunded,
      manualRefundCents: Math.max(0, b.manualRefundCents ?? (stamped || !legacy ? 0 : paid - refunded)),
      emailed: false,
      unpaidCheckout: paid === 0 && !legacy,
      recovered: true,
    });
  }
  return found;
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
    /**
     * Saves each booking's outcome as soon as it's known (finalizeClosure
     * keeps them on the closure action), so a run that dies partway loses
     * nobody. A failure to save is logged; it never stops the run.
     */
    record?: (bookingId: string, progress: ClosureProgressEntry) => Promise<void>;
  },
): Promise<ClosureResult> {
  const db = deps.db ?? defaultDb;
  const targets = await affectedBookings(db, opts.date, opts.slots);
  const reason = customerReason(opts.reason);
  const decideBy = opts.decideBy ?? closureDecideBy(opts.date, marinaNow(deps.now).date);

  const result: ClosureResult = emptyResult();
  const note = async (progress: ClosureProgressEntry): Promise<void> => {
    if (progress.bucket === 'cancelled') result.cancelled.push(progress.entry);
    else if (progress.bucket === 'offered') result.offered.push(progress.entry);
    else result.failed.push(progress.entry);
    if (!deps.record) return;
    try {
      await deps.record(progress.entry.id, progress);
    } catch (err) {
      logger.error('Couldn’t save a closure outcome', { blackoutId: opts.blackoutId, bookingId: progress.entry.id, err });
    }
  };
  for (const booking of targets) {
    const guests = Math.max(0, booking.guestCount);
    if (opts.choice === 'offer' && canOfferMove(booking)) {
      try {
        const sameClosure = booking.closure?.blackoutId === opts.blackoutId;
        if (sameClosure && booking.closure?.offerEmailedAt) {
          // A repeated run: this one was offered and emailed already.
          await note({ bucket: 'offered', entry: { id: booking.id, customerName: booking.customerName, timeSlot: booking.timeSlot, guests, decideBy: booking.closure.decideBy, emailed: true } });
          continue;
        }
        const closure = sameClosure ? { blackoutId: opts.blackoutId, reason: booking.closure!.reason, decideBy: booking.closure!.decideBy } : { blackoutId: opts.blackoutId, reason, decideBy };
        const marked = sameClosure ? booking : await markClosed(booking.id, closure, { db }, { date: booking.date, timeSlot: booking.timeSlot });
        if (!marked) continue; // cancelled, finished or moved off this trip since we looked
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
              kind: 'closureOffer',
              idempotencyKey: `closure-offer/${booking.id}/${opts.blackoutId}`,
            });
            emailed = true;
            await markClosureField(db, booking.id, opts.blackoutId, 'offerEmailedAt', deps.now);
          } catch (err) {
            logger.error('Closure offer email failed', { bookingId: booking.id, err });
          }
        }
        await note({ bucket: 'offered', entry: { id: booking.id, customerName: booking.customerName, timeSlot: booking.timeSlot, guests, decideBy: closure.decideBy, emailed } });
      } catch (err) {
        logger.error('Closure offer failed', { bookingId: booking.id, err });
        await note({ bucket: 'failed', entry: { id: booking.id, customerName: booking.customerName, error: 'Couldn’t offer a new date. Open the booking and sort it out there.' } });
      }
      continue;
    }
    try {
      const outcome = await adminCancelOne(
        booking.id,
        // Not if Travis or the customer moves it off this trip meanwhile.
        { reason, notifyCustomer: true, cause: 'blackout', closureId: opts.blackoutId, expect: { date: booking.date, timeSlot: booking.timeSlot } },
        { stripe: deps.stripe, mailer: deps.mailer, db },
      );
      if (outcome.kind === 'cancelled') {
        await note({ bucket: 'cancelled', entry: {
          id: booking.id,
          customerName: booking.customerName,
          timeSlot: booking.timeSlot,
          guests,
          refundCents: outcome.refundCents,
          manualRefundCents: outcome.manualRefundCents,
          emailed: outcome.emailed,
          unpaidCheckout: booking.status === 'pending-payment' && !isLegacyBooking(booking),
        } });
      } else if (outcome.kind === 'paid-meanwhile') {
        // Stripe's confirmation lands in a moment; finalizeClosure tries
        // this one again once it has.
        await note({ bucket: 'failed', entry: {
          id: booking.id,
          customerName: booking.customerName,
          error: 'They paid just as the day was closed. It’s being tried again in a couple of minutes; if it’s still here, open the booking and sort it out there.',
          retryable: true,
        } });
      } else if ((outcome.kind === 'changed' || outcome.kind === 'already-cancelled') && outcome.stripeRefundId) {
        // Moved or cancelled another way just as its refund went out.
        await note({ bucket: 'failed', entry: {
          id: booking.id,
          customerName: booking.customerName,
          error: `${formatPrice(outcome.refundCents ?? 0)} was refunded to them, but the booking changed at the same moment. Open the booking and check it.`,
          refundedAnyway: true,
        } });
      } else if (outcome.kind !== 'already-cancelled' && outcome.kind !== 'changed') {
        await note({ bucket: 'failed', entry: { id: booking.id, customerName: booking.customerName, error: outcome.kind } });
      }
    } catch (err) {
      logger.error('Blackout cancellation failed', { bookingId: booking.id, err });
      await note({ bucket: 'failed', entry: { id: booking.id, customerName: booking.customerName, error: 'Couldn’t cancel. Open the booking and cancel it there.' } });
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

/**
 * A closure Travis has confirmed on this departure that hasn't gone
 * through yet (its undo window is open, or it's going out right now).
 * Customers can't cancel or move such a booking themselves meanwhile: the
 * policy refund they'd get is less than the full one the closure gives.
 */
export async function closurePendingFor(
  db: Firestore,
  date: string,
  slot: string,
  tx?: FirebaseFirestore.Transaction,
): Promise<Pick<ClosureAction, 'choice' | 'finalizeAt'> | null> {
  const q = db.collection('closureActions').where('date', '==', date);
  const snap = tx ? await tx.get(q) : await q.get();
  for (const doc of snap.docs) {
    const a = doc.data() as ClosureAction;
    if ((a.state === 'pending' || a.state === 'finalizing') && closesSlot(a.affectedSlots, slot)) {
      return { choice: a.choice, finalizeAt: a.finalizeAt };
    }
  }
  return null;
}

/**
 * Which departures on `date` are closed: a blackout covers them. That
 * includes one Travis is closing right now, whose blackout goes up when he
 * confirms. The emails before a trip skip these: a "see you tomorrow"
 * during the undo window would land minutes before the cancellation, and
 * on a day he left booked he's contacting them himself. Once he reopens
 * the day, the next run sends it.
 */
export async function closedDeparturesOn(db: Firestore, date: string): Promise<(slot: string) => boolean> {
  const snap = await db.collection('blackouts').where('date', '==', date).get();
  const closed = snap.docs.map((d) => (d.data() as Blackout).affectedSlots);
  return (slot) => closed.some((slots) => closesSlot(slots, slot));
}

/** What a customer is told if they try to cancel during that window. */
export function closurePendingMessage(choice: ClosureChoice): string {
  if (choice === 'keep') {
    return `Capt. Travis just closed this trip and will be in touch with you directly. You can also call or text him at ${PHONE_DISPLAY}.`;
  }
  return choice === 'cancel'
    ? 'Capt. Travis just called this trip off. You’ll get an email in the next few minutes about your full refund.'
    : 'Capt. Travis just called this trip off. You’ll get an email in the next few minutes to pick a new date or take a full refund.';
}

/* -------------------------------------------------------------------------- */
/* What's left for Travis                                                     */
/* -------------------------------------------------------------------------- */

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * What a closure did and what Travis still has to do himself, in the same
 * words the admin screens use (src/components/admin/closure-summary.ts;
 * keep the two in step).
 */
export function closureReport(choice: ClosureChoice, result: ClosureResult): { summary: string[]; problems: string[] } {
  const summary: string[] = [];
  const problems: string[] = [];
  const cancelled = result.cancelled ?? [];
  const recovered = cancelled.filter((c) => c.recovered);
  const known = cancelled.filter((c) => !c.recovered);

  if (choice === 'cancel') {
    const auto = cancelled.reduce((sum, c) => sum + c.refundCents, 0);
    const notEmailed = known.filter((c) => !c.emailed);
    const emailed = known.length - notEmailed.length;
    if (cancelled.length) {
      summary.push(
        emailed === cancelled.length
          ? `Cancelled ${plural(cancelled.length, 'booking')} and emailed ${cancelled.length === 1 ? 'the customer' : 'each customer'}.`
          : `Cancelled ${plural(cancelled.length, 'booking')}. Emailed ${emailed} of them.`,
      );
    }
    if (auto > 0) summary.push(`${formatPrice(auto)} is going back to their cards.`);
    for (const n of notEmailed) problems.push(`Call or text ${n.customerName}: they weren’t emailed that their tour is off.`);
  } else if (choice === 'offer') {
    const offered = result.offered ?? [];
    const notEmailed = offered.filter((o) => !o.emailed);
    // Paid on the old website: cancelling one refunds nothing through
    // Stripe, so the money is his to send back.
    const oldSite = offered.filter((o) => isLegacyBooking({ id: o.id }));
    if (offered.length) {
      summary.push(
        `Emailed ${offered.length - notEmailed.length} of ${plural(offered.length, 'customer')} to pick a new date or take a full refund. ` +
          `Anyone who hasn’t chosen by ${crewDate(offered[0]!.decideBy)} is ${oldSite.length === offered.length ? 'cancelled' : 'refunded'} automatically.`,
      );
    }
    const unpaid = known.filter((c) => c.unpaidCheckout);
    const other = known.filter((c) => !c.unpaidCheckout);
    if (unpaid.length) summary.push(`Cancelled ${plural(unpaid.length, 'unfinished checkout')}.`);
    if (other.length) summary.push(`Cancelled ${plural(other.length, 'booking')} that couldn’t be offered a new date.`);
    for (const n of notEmailed) problems.push(`Call or text ${n.customerName}: they weren’t emailed that their tour is off.`);
    if (oldSite.length) {
      problems.push(
        `${plural(oldSite.length, 'booking')} from the old website (${oldSite.map((o) => o.customerName).join(', ')}): ` +
          `if they take the refund or don’t choose by ${crewDate(oldSite[0]!.decideBy)}, refund them yourself.`,
      );
    }
  } else {
    // Left booked: nobody was told anything, so it's all still his to do.
    const kept = result.kept ?? [];
    if (kept.length) {
      problems.push(
        `${plural(kept.length, 'booking is', 'bookings are')} still on for those trips. Contact ${kept.length === 1 ? 'that customer' : 'those customers'} yourself.`,
      );
    }
  }
  for (const r of recovered) {
    if (!r.unpaidCheckout) problems.push(`Check on ${r.customerName}: their booking was cancelled, but we can’t tell if they were emailed. Call or text them.`);
  }
  for (const m of cancelled.filter((c) => c.manualRefundCents > 0)) {
    problems.push(`Refund ${formatPrice(m.manualRefundCents)} to ${m.customerName} yourself (paid on the old website).`);
  }
  for (const f of result.failed ?? []) {
    // Moved or cancelled another way as it was refunded: telling him to
    // cancel it could cancel the trip they moved to, so it says what happened.
    if (f.refundedAnyway) {
      problems.push(`${f.customerName}: ${f.error}`);
      continue;
    }
    problems.push(
      f.retryable
        ? `${f.customerName} paid just as you closed it. It’s being tried again in a couple of minutes.`
        : choice === 'cancel'
          ? `${f.customerName}’s booking was NOT cancelled. Open it and cancel it there.`
          : `${f.customerName}’s booking wasn’t changed. Open it and sort it out there.`,
    );
  }
  return { summary, problems };
}

/**
 * Emails whoever closed the day what went out and what's left, once per
 * closure: the marker is claimed in a transaction before it's sent.
 */
export async function summarizeForAdminOnce(
  blackoutId: string,
  action: Pick<ClosureAction, 'date' | 'reason' | 'choice' | 'createdBy'>,
  result: ClosureResult,
  deps: { db: Firestore; notifyAdmin: NonNullable<FinalizeDeps['notifyAdmin']>; now?: Date; baseUrl: string },
): Promise<{ sent: boolean }> {
  const ref = deps.db.collection('closureActions').doc(blackoutId);
  const claimed = await deps.db.runTransaction(async (tx) => {
    const fresh = (await tx.get(ref)).data() as ClosureAction | undefined;
    if (!fresh || fresh.adminSummary?.claimedAt) return false;
    tx.update(ref, { adminSummary: { claimedAt: Timestamp.fromDate(deps.now ?? new Date()) } });
    return true;
  });
  if (!claimed) return { sent: false };

  const { summary, problems } = closureReport(action.choice, result);
  const { subject, html, text } = buildClosureSummaryEmail({
    date: action.date,
    dateLabel: crewDate(action.date),
    reason: customerReason(action.reason),
    summary,
    problems,
    adminUrl: `${deps.baseUrl}/admin/blackouts`,
  });
  let failed = false;
  try {
    await deps.notifyAdmin({ to: action.createdBy, subject, html, text, idempotencyKey: `closure-summary/${blackoutId}` });
  } catch (err) {
    failed = true;
    logger.error('Closure summary email failed', { blackoutId, err });
  }
  await ref.update({
    adminSummary: {
      claimedAt: Timestamp.fromDate(deps.now ?? new Date()),
      ...(failed ? { failed: true } : { sentAt: Timestamp.fromDate(deps.now ?? new Date()) }),
      to: action.createdBy,
    },
  });
  return { sent: !failed };
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
function crewTime(slot: TourTimeSlot, date: string): string {
  const short = departsDisplay(slot, date).replace(/ [AP]M$/, '');
  return slot === 'whole-day' ? `${short} all-day` : short;
}

function joinWords(words: string[]): string {
  if (words.length <= 1) return words[0] ?? '';
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

/** Who a closure's crew alert is about: everyone it called off or left booked, not checkouts still being paid for. */
function calledOffIn(result: ClosureResult | undefined) {
  if (!result) return [];
  return [...(result.cancelled ?? []).filter((c) => !c.unpaidCheckout), ...(result.offered ?? []), ...(result.kept ?? [])];
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
  const calledOff = calledOffIn(result);
  if (calledOff.length === 0) return { sent: false };
  const ref = deps.db.collection('closureActions').doc(blackoutId);
  const claimed = await deps.db.runTransaction(async (tx) => {
    const fresh = (await tx.get(ref)).data() as ClosureAction | undefined;
    if (!fresh || fresh.crewAlert?.claimedAt) return false;
    tx.update(ref, { crewAlert: { claimedAt: Timestamp.fromDate(deps.now ?? new Date()) } });
    return true;
  });
  if (!claimed) return { sent: false };

  const slots = [...new Set(calledOff.map((c) => c.timeSlot))].sort(
    (a, b) => startMinutes(a, action.date) - startMinutes(b, action.date),
  );
  const label = action.choice === 'keep' ? 'Closed' : action.reason === 'weather' ? 'Weather cancel' : 'Trips cancelled';
  const when = joinWords(slots.map((s) => crewTime(s, action.date)));
  const guestText = crewGuests(calledOff);
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

  const { html, text } = buildCrewClosureAlertEmail({
    subject,
    date: action.date,
    reason: customerReason(action.reason),
    choice: action.choice,
    guests: guestText,
    departures: slots.map((slot) => ({
      departs: departsDisplay(slot, action.date),
      slot,
      guests: crewGuests(calledOff.filter((c) => c.timeSlot === slot)),
    })),
    crewUrl: `${deps.baseUrl}/crew`,
  });
  const { emailed, failed } = await emailEveryCrewMember(deps.db, deps.crew, { subject, html, text }, `crew-closure/${blackoutId}`);
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

/** The same email to every crew member with an address. One that fails is logged and the rest still go. */
async function emailEveryCrewMember(
  db: Firestore,
  crew: CrewAlertSender,
  msg: { subject: string; html: string; text: string },
  keyPrefix: string,
): Promise<{ emailed: string[]; failed: string[] }> {
  const crewSnap = await db.collection('crew').get();
  const emailed: string[] = [];
  const failed: string[] = [];
  for (const doc of crewSnap.docs) {
    const email = (doc.data() as { email?: string }).email;
    if (!email) continue;
    try {
      await crew.email({ to: email, ...msg, idempotencyKey: `${keyPrefix}/${doc.id}` });
      emailed.push(doc.id);
    } catch (err) {
      logger.error('Crew email failed', { keyPrefix, crewId: doc.id, err });
      failed.push(doc.id);
    }
  }
  return { emailed, failed };
}

/** "4 guests"; "4+ guests" or "party size unknown" with old-site bookings that have none on file (the crew calendar's wording). */
function crewGuests(list: ReadonlyArray<{ guests: number }>): string {
  const known = list.filter((r) => r.guests > 0);
  const n = known.reduce((s, r) => s + r.guests, 0);
  if (known.length === list.length) return `${n} ${n === 1 ? 'guest' : 'guests'}`;
  return n > 0 ? `${n}+ guests` : 'party size unknown';
}

type CrewAlertMarker = NonNullable<ClosureAction['reopenCrewAlert']>;

/** Whether the push and every crew email went. */
function reachedEveryone(m: CrewAlertMarker): boolean {
  return !!m.sentAt && !!m.pushed && !m.failedCrewIds?.length;
}

/**
 * When reopening a day puts people back on trips the crew were told were
 * off, the crew hear they're on again: a push with the closure alert's
 * tag, so it replaces that one on their phones, and an email to each crew
 * member. Once per closure (`reopenCrewAlert`, claimed in a transaction
 * like `crewAlert`): a retried reopen doesn't send it again, and gets back
 * how the first one went.
 *
 * Who's back on: `restored`, and on a day Travis left booked ("keep") the
 * bookings it left that are still on their trips. Those were never taken
 * off, but the crew heard the trips were closed. The crew heard about them
 * from this closure's alert or, when this one never sent one (an undo that
 * put back someone an earlier closure offered a new date, see
 * undoClosure), from an earlier closure of the same trips that named them.
 *
 * A day closed from MCP has no closure action and told the crew nothing
 * itself, but taking it down can put back people an earlier closure's
 * alert named (that closure was reopened while this one still covered
 * them). The crew hear about those too, claimed once on that earlier
 * closure under this blackout's id (`reopenCrewAlertsFor`).
 *
 * `told` is false if the push or any email failed, so Travis knows to tell
 * them himself. Null when there's nothing to tell: nobody is back on, or
 * the crew never heard those trips were off.
 */
export async function alertCrewRestoredOnce(
  blackoutId: string,
  restored: readonly RestoredBooking[],
  deps: { db?: Firestore; crew: CrewAlertSender; now?: Date; baseUrl: string },
): Promise<{ told: boolean } | null> {
  const db = deps.db ?? defaultDb;
  const nowDate = deps.now ?? new Date();
  const at = Timestamp.fromDate(nowDate);
  const ref = db.collection('closureActions').doc(blackoutId);
  const action = (await ref.get()).data() as ClosureAction | undefined;
  // A booking only carries a closure on that closure's date, so they're all on it.
  const date = action?.date ?? restored[0]?.date;
  // Without an action, the blackout's id becomes a field name on the earlier one.
  if (!date || (!action && !SAFE_ID.test(blackoutId))) return null;
  const kept = action ? await stillKept(db, blackoutId, action, restored, nowDate) : [];
  let back: RestoredBooking[] = [...restored, ...kept];
  let tagId = blackoutId;
  if (!action?.crewAlert?.sentAt) {
    // Latest first, so the push replaces the newest one on their phones.
    const earlier = (await db.collection('closureActions').where('date', '==', date).get()).docs
      .map((d) => ({ id: d.id, alert: (d.data() as ClosureAction).crewAlert, result: (d.data() as ClosureAction).result }))
      .filter((a) => a.id !== blackoutId && !!a.alert?.sentAt)
      .sort((a, b) => b.alert!.sentAt!.toMillis() - a.alert!.sentAt!.toMillis())
      .map((a) => ({ id: a.id, named: new Set(calledOffIn(a.result).map((c) => c.id)) }));
    back = back.filter((r) => earlier.some((a) => a.named.has(r.id)));
    tagId = earlier.find((a) => back.some((r) => a.named.has(r.id)))?.id ?? blackoutId;
  }
  if (back.length === 0) return null;
  // Without an action of its own, back is non-empty only with an earlier one (tagId).
  const claimRef = action ? ref : db.collection('closureActions').doc(tagId);
  const field = action ? 'reopenCrewAlert' : `reopenCrewAlertsFor.${blackoutId}`;
  const claim = await db.runTransaction(async (tx) => {
    const fresh = (await tx.get(claimRef)).data() as ClosureAction | undefined;
    if (!fresh) return null;
    const earlier = action ? fresh.reopenCrewAlert : fresh.reopenCrewAlertsFor?.[blackoutId];
    if (earlier) return { mine: false as const, earlier };
    tx.update(claimRef, { [field]: { claimedAt: at } });
    return { mine: true as const };
  });
  if (!claim) return null;
  if (!claim.mine) return { told: reachedEveryone(claim.earlier) };

  const slots = [...new Set(back.map((r) => r.timeSlot))].sort((a, b) => startMinutes(a, date) - startMinutes(b, date));
  const when = joinWords(slots.map((s) => crewTime(s, date)));
  const guestText = crewGuests(back);
  const subject = `[CRMF] Back on: ${crewDate(date)}, ${when} (${guestText})`;

  let pushed = false;
  try {
    await deps.crew.push({
      title: `Back on: ${crewDate(date)}`,
      body: `${when} ${slots.length === 1 ? 'is' : 'are'} going out after all · ${guestText}`,
      url: '/crew',
      tag: `closure-${tagId}`,
    });
    pushed = true;
  } catch (err) {
    logger.error('Crew reopen push failed', { blackoutId, err });
  }

  const { html, text } = buildCrewReopenAlertEmail({
    subject,
    date,
    // Nobody was asked to pick a new date: Travis left them all booked.
    leftBooked: back.every((r) => kept.includes(r)),
    departures: slots.map((slot) => ({
      departs: departsDisplay(slot, date),
      slot,
      guests: crewGuests(back.filter((r) => r.timeSlot === slot)),
    })),
    crewUrl: `${deps.baseUrl}/crew`,
  });
  const { emailed, failed } = await emailEveryCrewMember(db, deps.crew, { subject, html, text }, `crew-reopen/${blackoutId}`);
  const marker: CrewAlertMarker = { claimedAt: at, sentAt: at, subject, pushed, emailedCrewIds: emailed, failedCrewIds: failed };
  await claimRef.update({ [field]: marker });
  return { told: reachedEveryone(marker) };
}

/**
 * A day Travis left booked ("keep") coming down, after the crew heard it
 * was closed: the bookings it left that are still on their trips (not
 * cancelled, moved, waiting on a new date or gone out already), other than
 * those in `restored`. Not a trip another closed day still covers: it's
 * still closed, and the crew have heard that from that one if it told them.
 */
async function stillKept(
  db: Firestore,
  blackoutId: string,
  action: ClosureAction,
  restored: readonly RestoredBooking[],
  nowDate: Date,
): Promise<RestoredBooking[]> {
  if (action.choice !== 'keep' || !action.crewAlert?.sentAt) return [];
  const now = marinaNow(nowDate);
  const others = (await db.collection('blackouts').where('date', '==', action.date).get()).docs
    .filter((d) => d.id !== blackoutId)
    .map((d) => (d.data() as Blackout).affectedSlots);
  const out: RestoredBooking[] = [];
  for (const k of action.result?.kept ?? []) {
    if (restored.some((r) => r.id === k.id)) continue;
    const b = (await db.collection('bookings').doc(k.id).get()).data() as Booking | undefined;
    if (!b || !isActive(b) || b.closure || b.date !== action.date || b.timeSlot !== k.timeSlot) continue;
    if (departureStarted(b.date, b.timeSlot, now)) continue;
    if (others.some((slots) => closesSlot(slots, b.timeSlot))) continue;
    out.push(restoredBooking(k.id, b));
  }
  return out;
}

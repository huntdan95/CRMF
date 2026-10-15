import { logger } from 'firebase-functions/v2';
import type { Firestore } from 'firebase-admin/firestore';

import { db as defaultDb, FieldValue } from './firebase';
import { awaitingMove } from './closure';
import { addDays, marinaNow } from './datetime';
import { emailKindLabel } from './email-log';
import { isPermanentBounce, sameAddress } from './email-events';
import { isGoingAhead, type Booking, type EmailBounce } from './types';

/**
 * "Fix email and resend" on an admin booking page: Travis puts in the
 * customer's right address, and each email that bounced goes out again to
 * it, where the site has a way to send that email again. Emails it can't
 * send again are reported back, so he knows to call.
 */

/**
 * How each bounced email can go out again, to the booking's new address.
 * Each throws if it isn't sent. `bounce` is the one being replaced; its
 * email id makes a good idempotency key, so a second tap (or a retry) on
 * the same bounce doesn't send twice.
 */
export interface ResendPaths {
  /** The confirmation, through the existing "Email the confirmation again" path. */
  confirmation(booking: Booking, bounce: EmailBounce): Promise<void>;
  /** "Updated:" confirmation after a move. */
  updatedConfirmation(booking: Booking, bounce: EmailBounce): Promise<void>;
  /** "Pick a new date or a refund" after Travis closed the departure. */
  closureOffer(booking: Booking, bounce: EmailBounce): Promise<void>;
  /** Tomorrow's reminder. */
  reminder(booking: Booking, bounce: EmailBounce): Promise<void>;
  /** "Thanks for coming", sent even if one already went. */
  followup(booking: Booking, bounce: EmailBounce): Promise<{ sent: boolean; skipped?: string }>;
}

export interface ResendResult {
  kind: string;
  /** "booking confirmation". */
  label: string;
  /** The bounced address. */
  bouncedTo: string;
  outcome: 'resent' | 'skipped' | 'failed';
  /** Why it wasn't sent, in plain English. */
  reason?: string;
  /** Not sent, and Travis should call them about it. */
  callThem?: boolean;
}

export type FixOutcome =
  | { kind: 'not-found' }
  | { kind: 'nothing-bounced' }
  /** That address bounced permanently: it doesn't work. */
  | { kind: 'same-address'; address: string }
  | { kind: 'done'; before: string; after: string; results: ResendResult[] };

/** The order they go out in: the confirmation (with the booking's details) first. */
const ORDER = ['confirmation', 'reschedule', 'closureOffer', 'reminder', 'followup'];

const FOLLOWUP_SKIPPED: Record<string, string> = {
  'not-yet': 'The trip hasn’t happened yet.',
  'too-old': 'The trip was too long ago for a thank-you.',
  'not-confirmed': 'The booking isn’t confirmed or completed.',
  closed: 'You closed that departure.',
  'not-found': 'The booking couldn’t be found.',
};

const NO_PATH = 'There’s no way to send this one again from here.';

/** Kinds are field names (`emailBounces.<kind>`), so only plain ones. */
const SAFE_KIND = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

export async function fixBouncedEmail(
  bookingId: string,
  newEmail: string,
  deps: { db?: Firestore; now?: Date; paths: ResendPaths },
): Promise<FixOutcome> {
  const db = deps.db ?? defaultDb;
  const ref = db.collection('bookings').doc(bookingId);
  const email = newEmail.trim();

  // 1. New address on the booking. Each bounced kind's alert marker is
  //    cleared first, so if the resend bounces too, Travis hears about it.
  const start = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { kind: 'not-found' as const };
    const booking = { ...(snap.data() as Booking), id: bookingId };
    const bounces = Object.entries(booking.emailBounces ?? {}).filter(([k]) => SAFE_KIND.test(k));
    if (bounces.length === 0) return { kind: 'nothing-bounced' as const };
    const dead = bounces.find(([, b]) => isPermanentBounce(b.bounceType) && sameAddress(b.to, email));
    if (dead) return { kind: 'same-address' as const, address: dead[1].to };

    const update: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
    if (email !== booking.customerEmail) update.customerEmail = email;
    for (const [k] of bounces) {
      update[`bounceAlertSentAt.${k}`] = FieldValue.delete();
      update[`bounceAlertClaims.${k}`] = FieldValue.delete();
    }
    tx.update(ref, update);
    return {
      kind: 'ok' as const,
      before: booking.customerEmail,
      booking: { ...booking, customerEmail: email },
      bounces: new Map(bounces),
    };
  });
  if (start.kind !== 'ok') return start;

  // 2. Each bounced email again, one at a time; one failing doesn't stop the rest.
  const { booking, bounces } = start;
  const kinds = [...bounces.keys()].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  const results: ResendResult[] = [];
  const now = deps.now ?? new Date();
  let confirmationResult: ResendResult | null = null;
  for (const kind of kinds) {
    const bounce = bounces.get(kind)!;
    const base = { kind, label: emailKindLabel(kind), bouncedTo: bounce.to };
    // The confirmation carries the booking's current details, so an
    // updated confirmation that bounced too is covered by it.
    if (kind === 'reschedule' && confirmationResult) {
      results.push({ ...base, outcome: confirmationResult.outcome, reason: confirmationResult.reason, callThem: confirmationResult.callThem });
      continue;
    }
    let result: ResendResult;
    try {
      result = { ...base, ...(await resendOne(kind, booking, bounce, now, deps.paths)) };
    } catch (err) {
      logger.error('Resending a bounced email failed', { bookingId, kind, err });
      result = {
        ...base,
        outcome: 'failed',
        reason: err instanceof Error && err.message.startsWith('Resend failed') ? err.message : 'It didn’t send.',
      };
    }
    if (kind === 'confirmation') confirmationResult = result;
    results.push(result);
  }

  // 3. Clear what's been dealt with. A failed one stays, so Travis can try
  //    again; so does any bounce that's landed since (a different email id).
  try {
    await db.runTransaction(async (tx) => {
      const fresh = (await tx.get(ref)).data() as Booking | undefined;
      if (!fresh) return;
      const current = fresh.emailBounces ?? {};
      const clear = results
        .filter((r) => r.outcome !== 'failed' && current[r.kind]?.emailId === bounces.get(r.kind)!.emailId)
        .map((r) => r.kind);
      if (clear.length === 0) return;
      const left = Object.keys(current).filter((k) => !clear.includes(k));
      tx.update(
        ref,
        left.length === 0
          ? { emailBounces: FieldValue.delete() }
          : Object.fromEntries(clear.map((k) => [`emailBounces.${k}`, FieldValue.delete()])),
      );
    });
  } catch (err) {
    // The emails went; the badge just stays up. Fixing again clears it.
    logger.error('Couldn’t clear the bounce flags', { bookingId, err });
  }

  return { kind: 'done', before: start.before, after: email, results };
}

function rank(kind: string): number {
  const i = ORDER.indexOf(kind);
  return i === -1 ? ORDER.length : i;
}

type Sent = Pick<ResendResult, 'outcome' | 'reason' | 'callThem'>;

async function resendOne(kind: string, b: Booking, bounce: EmailBounce, now: Date, paths: ResendPaths): Promise<Sent> {
  const today = marinaNow(now).date;
  switch (kind) {
    case 'confirmation':
    case 'reschedule':
      if (b.status !== 'confirmed') return { outcome: 'skipped', reason: 'The booking isn’t confirmed any more.' };
      if (kind === 'confirmation') await paths.confirmation(b, bounce);
      else await paths.updatedConfirmation(b, bounce);
      return { outcome: 'resent' };

    case 'closureOffer':
      if (!awaitingMove(b)) return { outcome: 'skipped', reason: 'They’re not waiting on a choice any more.' };
      if (b.closure!.decideBy < today) {
        return { outcome: 'skipped', reason: 'The time to pick a new date has passed.', callThem: true };
      }
      await paths.closureOffer(b, bounce);
      return { outcome: 'resent' };

    case 'reminder': {
      const tomorrow = addDays(today, 1);
      if (!isGoingAhead(b) || b.closure) return { outcome: 'skipped', reason: 'The trip isn’t going ahead.' };
      if (b.date > tomorrow) return { outcome: 'skipped', reason: 'A reminder goes out by itself the day before the trip.' };
      // The reminder says "tomorrow".
      if (b.date < tomorrow) {
        return { outcome: 'skipped', reason: 'The reminder is for the day before, and the trip is today or over.', callThem: b.date === today };
      }
      await paths.reminder(b, bounce);
      return { outcome: 'resent' };
    }

    case 'followup': {
      const r = await paths.followup(b, bounce);
      if (r.sent) return { outcome: 'resent' };
      return { outcome: 'skipped', reason: FOLLOWUP_SKIPPED[r.skipped ?? ''] ?? 'It wasn’t sent.' };
    }

    default:
      // A cancellation, a "we got your request" note, or anything newer:
      // sending those again means re-running what sent them, which isn't safe.
      return { outcome: 'skipped', reason: NO_PATH, callThem: true };
  }
}

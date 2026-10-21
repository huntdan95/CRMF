import { onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import { z } from 'zod';

import { db, FieldValue } from './lib/firebase';
import { STRIPE_SECRET_KEY, getStripe } from './lib/stripe';
import { RESEND_API_KEY, RESEND_FROM_EMAIL } from './lib/resend';
import { isEmailSendError, sendEmail } from './lib/email-log';
import { ADMIN_EMAIL, APP_BASE_URL, MCP_TOKEN } from './lib/config';
import { VAPID_PRIVATE_KEY, sendCrewPush } from './lib/crew-push';
import { customerMailerFor } from './lib/customer-mailer';
import {
  ClosureError,
  affectedBookings,
  alertCrewClosedFromMcp,
  alertCrewRestoredOnce,
  assertClosable,
  assertReopenable,
  confirmClosure,
  confirmPaidWhileClosed,
  finalizeClosure,
  finalizeDueClosures,
  findLeftStillBooked,
  findStillClosed,
  previewClosure,
  restoreOfferedBookings,
  undoClosure,
  type CrewAlertSender,
  type FinalizeDeps,
  type RestoredBooking,
} from './lib/close-day';
import { isRealDate, marinaNow } from './lib/datetime';
import { sendBookingConfirmation } from './lib/send-confirmation';
import {
  applyCors,
  badRequest,
  methodNotAllowed,
  serverError,
} from './lib/http';
import {
  requireAdmin,
  writeAudit,
  AdminAuthError,
  type AdminContext,
} from './lib/admin-auth';
import type { Blackout, ClosureAction } from './lib/types';

function handleAuthError(res: import('express').Response, err: unknown): boolean {
  if (err instanceof AdminAuthError) {
    res.status(err.status).json({ error: err.message });
    return true;
  }
  return false;
}

function handleClosureError(res: import('express').Response, err: unknown): boolean {
  if (err instanceof ClosureError) {
    res.status(err.status).json({ error: err.message, ...(err.code && { code: err.code }) });
    return true;
  }
  return false;
}

const allSlotValues = [
  'morning',
  'mid-morning',
  'early-afternoon',
  'late-afternoon',
  'whole-day',
  'sunset',
  'all',
] as const;

const reasonValues = ['weather', 'maintenance', 'personal', 'other'] as const;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(isRealDate, 'Not a real calendar date');

/** Crew push through the crew app, crew email through Resend. */
function crewSender(): CrewAlertSender {
  return {
    push: (msg) => sendCrewPush(msg),
    async email({ to, subject, html, text, idempotencyKey }) {
      try {
        // Logged as a crew email: its bounces are recorded but never alert.
        await sendEmail({
          kind: 'crew',
          to,
          subject,
          html,
          text,
          replyTo: ADMIN_EMAIL.value(),
          headers: { 'X-Email-Type': 'crew-closure' },
          idempotencyKey,
        });
      } catch (err) {
        // The same key with a different email: this one already went out.
        if (isEmailSendError(err, 'invalid_idempotent_request')) return;
        throw err;
      }
    },
  };
}

function finalizeDeps(): FinalizeDeps {
  return {
    baseUrl: APP_BASE_URL.value(),
    stripe: getStripe(),
    mailer: (adminEmail) => customerMailerFor(adminEmail || ADMIN_EMAIL.value()),
    crew: crewSender(),
    async notifyAdmin({ to, subject, html, text, idempotencyKey }) {
      // Whoever closed the day, and Travis if it wasn't him.
      const owner = ADMIN_EMAIL.value();
      const recipients = [...new Set([to, owner].filter(Boolean).map((a) => a.trim().toLowerCase()))];
      try {
        await sendEmail({ kind: 'admin', to: recipients, subject, html, text, idempotencyKey });
      } catch (err) {
        if (isEmailSendError(err, 'invalid_idempotent_request')) return;
        throw err;
      }
    },
    audit: writeAudit,
  };
}

/**
 * Tells the crew that trips they heard were off are going out after all
 * (alertCrewRestoredOnce). Null when there was nothing to tell them, else
 * whether it reached them all. A failure is logged and never stops the
 * reopen or undo it follows: Travis is told to let them know himself.
 * `blackout`: a day closed from MCP, as it was before it came down.
 */
async function tellCrewBackOn(
  blackoutId: string,
  restored: RestoredBooking[],
  blackout?: Pick<Blackout, 'date' | 'affectedSlots' | 'createdAt' | 'crewAlert'>,
): Promise<boolean | null> {
  try {
    const alert = await alertCrewRestoredOnce(blackoutId, restored, { crew: crewSender(), baseUrl: APP_BASE_URL.value(), blackout });
    return alert ? alert.told : null;
  } catch (err) {
    logger.error('Crew reopen alert failed', { blackoutId, err });
    return false;
  }
}

/**
 * Anyone who paid for those trips while they were closed gets the
 * confirmation that was held back (confirmPaidWhileClosed), now they're on
 * again. Returned for the page: `confirmationsSent`, and
 * `confirmationsFailed` for Travis to send from the booking page or call.
 * A failure is logged and never stops the reopen or undo.
 */
async function confirmHeldBack(
  blackoutId: string,
  closed: { date: string; affectedSlots: readonly string[] } | undefined,
): Promise<{ confirmationsSent?: RestoredBooking[]; confirmationsFailed?: RestoredBooking[] }> {
  if (!closed) return {};
  try {
    const { sent, failed } = await confirmPaidWhileClosed(blackoutId, closed, { send: (id) => sendBookingConfirmation(id) });
    return { ...(sent.length > 0 && { confirmationsSent: sent }), ...(failed.length > 0 && { confirmationsFailed: failed }) };
  } catch (err) {
    logger.error('Confirmations after a reopen failed', { blackoutId, err });
    return {};
  }
}

/**
 * Put back by an earlier try at a reopen (restoreOfferedBookings), split
 * into those back on a trip still to come and those whose trip has left
 * since (`alreadyLeft`): the crew hear only about the first, and Travis is
 * told to check whether the others went.
 */
function splitLeft(restored: RestoredBooking[]): { back: RestoredBooking[]; alreadyLeft: RestoredBooking[] } {
  return { back: restored.filter((r) => !r.left), alreadyLeft: restored.filter((r) => r.left) };
}

/** The crew alert after a reopen or undo: email through Resend, push through the crew app. */
const CREW_ALERT_SECRETS = [RESEND_API_KEY, RESEND_FROM_EMAIL, APP_BASE_URL, VAPID_PRIVATE_KEY];

/** Everything closing a day can touch: refunds, customer and crew emails, crew push. */
const CLOSE_DAY_SECRETS = [STRIPE_SECRET_KEY, RESEND_API_KEY, RESEND_FROM_EMAIL, APP_BASE_URL, VAPID_PRIVATE_KEY];

/** Closing a day with people booked can refund them: never through MCP. */
async function requireSiteAdmin(req: Parameters<typeof requireAdmin>[0]): Promise<AdminContext> {
  return requireAdmin(req);
}

// ===========================================================================
// adminCreateBlackout: stop new bookings, and tell the crew.
// ===========================================================================
/**
 * Closes departures to new bookings and does nothing to the people already
 * booked. The MCP endpoint's create_blackout uses it. Closing a day from
 * the admin site goes through adminPreviewClosure / adminConfirmClosure,
 * which can cancel or email the people booked, with a review step and an
 * undo window first. With people still going out on those trips, the crew
 * get the "Closed" alert a day left booked sends (alertCrewClosedFromMcp):
 * `crewTold` says whether it reached them all. A failure there is logged
 * and doesn't stop the closing.
 */
export const adminCreateBlackout = onRequest(
  {
    cors: false,
    secrets: [MCP_TOKEN, ...CREW_ALERT_SECRETS],
    maxInstances: 5,
  },
  async (req, res) => {
    if (applyCors(req, res)) return;
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    try {
      const admin = await requireAdmin(req, { allowMcp: true });
      const parsed = z
        .object({
          date: isoDate,
          affectedSlots: z.array(z.enum(allSlotValues)).min(1),
          reason: z.enum(reasonValues).optional(),
          notes: z.string().trim().max(500).optional(),
          // Kept so an admin page loaded before the review step existed gets
          // a clear answer rather than a silent close.
          cancelAffected: z.boolean().default(false),
          offerMove: z.boolean().default(false),
        })
        .safeParse(req.body);
      if (!parsed.success) return badRequest(res, 'Invalid input', parsed.error.format());
      if (parsed.data.cancelAffected || parsed.data.offerMove) {
        res.status(409).json({
          error: 'Closing a day with people booked now has a review step. Reload the page and try again.',
          code: 'stale',
        });
        return;
      }
      // The admin site's rules: not a past date, nor a departure that has
      // left (a 400 naming it). A blackout over a trip that ran would have it
      // treated as one that didn't: no review request, no marking it, and
      // "closed" on the guests' booking page.
      assertClosable(
        parsed.data.date,
        parsed.data.affectedSlots,
        marinaNow(),
        await affectedBookings(db, parsed.data.date, parsed.data.affectedSlots),
      );

      const ref = await db.collection('blackouts').add({
        date: parsed.data.date,
        affectedSlots: parsed.data.affectedSlots,
        reason: parsed.data.reason ?? null,
        notes: parsed.data.notes ?? null,
        createdAt: FieldValue.serverTimestamp(),
      });

      let crewTold: boolean | null;
      try {
        crewTold = (await alertCrewClosedFromMcp(ref.id, { crew: crewSender(), baseUrl: APP_BASE_URL.value() }))?.told ?? null;
      } catch (err) {
        logger.error('Crew closure alert failed', { blackoutId: ref.id, err });
        crewTold = false;
      }

      await writeAudit({
        admin,
        action: 'blackout.create',
        targetId: ref.id,
        payload: {
          date: parsed.data.date,
          affectedSlots: parsed.data.affectedSlots,
          reason: parsed.data.reason ?? null,
          cancelledBookingIds: [],
          offeredBookingIds: [],
          failedBookingIds: [],
          ...(crewTold !== null && { crewTold }),
        },
      });

      res.status(200).json({ ok: true, blackoutId: ref.id, cancelledBookingIds: [], ...(crewTold !== null && { crewTold }) });
    } catch (err) {
      if (handleAuthError(res, err)) return;
      if (handleClosureError(res, err)) return;
      serverError(res, err);
    }
  },
);

// ===========================================================================
// adminPreviewClosure: what closing these departures would do. Sends nothing.
// ===========================================================================
export const adminPreviewClosure = onRequest(
  { cors: false, secrets: [APP_BASE_URL], maxInstances: 5 },
  async (req, res) => {
    if (applyCors(req, res)) return;
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    try {
      const admin = await requireSiteAdmin(req);
      const parsed = z
        .object({
          date: isoDate,
          affectedSlots: z.array(z.enum(allSlotValues)).min(1),
          reason: z.enum(reasonValues).optional(),
          notes: z.string().trim().max(500).optional(),
        })
        .safeParse(req.body);
      if (!parsed.success) return badRequest(res, 'Invalid input', parsed.error.format());
      const preview = await previewClosure(parsed.data, admin, { baseUrl: APP_BASE_URL.value(), audit: writeAudit });
      res.status(200).json({ ok: true, ...preview });
    } catch (err) {
      if (handleAuthError(res, err)) return;
      if (handleClosureError(res, err)) return;
      serverError(res, err);
    }
  },
);

// ===========================================================================
// adminConfirmClosure: the red button. Blocks the departures at once.
// ===========================================================================
export const adminConfirmClosure = onRequest(
  {
    cors: false,
    secrets: CLOSE_DAY_SECRETS,
    maxInstances: 5,
    // With no undo window it finalizes right away: a refund per booking.
    timeoutSeconds: 300,
  },
  async (req, res) => {
    if (applyCors(req, res)) return;
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    try {
      const admin = await requireSiteAdmin(req);
      const parsed = z
        .object({
          confirmToken: z.string().min(20).max(100),
          choice: z.enum(['offer', 'cancel', 'keep']),
          confirmText: z.string().max(40).optional(),
        })
        .safeParse(req.body);
      if (!parsed.success) return badRequest(res, 'Invalid input', parsed.error.format());
      const outcome = await confirmClosure(parsed.data, admin, finalizeDeps());
      res.status(200).json({ ok: true, ...outcome });
    } catch (err) {
      if (handleAuthError(res, err)) return;
      if (handleClosureError(res, err)) return;
      serverError(res, err);
    }
  },
);

// ===========================================================================
// adminUndoClosure: take it back while the undo window is open.
// ===========================================================================
/**
 * Undo can put back on their trips people an earlier closure of the same
 * trips offered a new date (undoClosure): `restored` lists them, not
 * emailed, and if the crew were told those trips were off they hear
 * they're back on (`crewTold`, as for a reopen), the 8 PM schedule and a
 * new booking's alert included. Anyone who paid during the window gets the
 * confirmation held back from them (`confirmationsSent`). Anyone still
 * booked on a trip it covered that left during the window is named
 * (`alreadyLeft`): that trip now counts as having run. `stillClosed`:
 * another closed day still covers `all` or `some` of its trips, so the
 * page doesn't say they're open for booking again.
 */
export const adminUndoClosure = onRequest(
  { cors: false, secrets: CREW_ALERT_SECRETS, maxInstances: 5 },
  async (req, res) => {
    if (applyCors(req, res)) return;
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    try {
      const admin = await requireSiteAdmin(req);
      const parsed = z.object({ blackoutId: z.string().min(1).max(64) }).safeParse(req.body);
      if (!parsed.success) return badRequest(res, 'Invalid input', parsed.error.format());
      const { blackoutId } = parsed.data;
      const outcome = await undoClosure(blackoutId, admin, { audit: writeAudit });
      switch (outcome.kind) {
        case 'undone':
        case 'already-undone': {
          // A retry after a dropped connection: who the first try put back,
          // from the closure's record.
          const { back: restored } = splitLeft(outcome.kind === 'undone' ? outcome.restored : await restoreOfferedBookings(blackoutId));
          const crewTold = await tellCrewBackOn(blackoutId, restored);
          const action =
            outcome.kind === 'undone'
              ? outcome.action
              : ((await db.collection('closureActions').doc(blackoutId).get()).data() as ClosureAction | undefined);
          const confirmations = await confirmHeldBack(blackoutId, action);
          const alreadyLeft =
            outcome.kind === 'undone' ? outcome.alreadyLeft : action ? await findLeftStillBooked(blackoutId, action) : [];
          const stillClosed = outcome.kind === 'undone' ? outcome.stillClosed : action?.stillClosed;
          res.status(200).json({
            ok: true,
            restored,
            ...(crewTold !== null && { crewTold }),
            ...confirmations,
            ...(alreadyLeft.length > 0 && { alreadyLeft }),
            ...(stillClosed && { stillClosed }),
          });
          return;
        }
        case 'too-late':
          res.status(409).json({
            error:
              outcome.state === 'done'
                ? 'Too late to undo: it’s already gone out. Reopen the day below if you want to take bookings again.'
                : 'Too late to undo: it’s going out right now. Check back in a minute.',
          });
          return;
        case 'not-found':
          res.status(404).json({ error: 'Couldn’t find that closed day. Reload the page.' });
          return;
      }
    } catch (err) {
      if (handleAuthError(res, err)) return;
      serverError(res, err);
    }
  },
);

// ===========================================================================
// adminSendClosureNow: skip the rest of the undo window.
// ===========================================================================
export const adminSendClosureNow = onRequest(
  { cors: false, secrets: CLOSE_DAY_SECRETS, maxInstances: 5, timeoutSeconds: 300 },
  async (req, res) => {
    if (applyCors(req, res)) return;
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    try {
      const admin = await requireSiteAdmin(req);
      const parsed = z.object({ blackoutId: z.string().min(1).max(64) }).safeParse(req.body);
      if (!parsed.success) return badRequest(res, 'Invalid input', parsed.error.format());
      const { blackoutId } = parsed.data;
      const action = (await db.collection('closureActions').doc(blackoutId).get()).data() as ClosureAction | undefined;
      if (action?.state === 'pending') {
        await writeAudit({
          admin,
          action: 'closure.send-now',
          targetId: blackoutId,
          payload: {
            date: action.date,
            affectedSlots: action.affectedSlots,
            choice: action.choice,
            secondsEarly: Math.max(0, Math.round((action.finalizeAt.toMillis() - Date.now()) / 1000)),
          },
        });
      }
      const outcome = await finalizeClosure(blackoutId, 'send-now', finalizeDeps(), admin);
      switch (outcome.kind) {
        case 'finalized':
        case 'already-done':
          res.status(200).json({ ok: true, result: outcome.result, retrying: outcome.kind === 'finalized' && !!outcome.retrying });
          return;
        case 'busy':
          res.status(409).json({ error: 'It’s going out right now. Check back in a minute.' });
          return;
        case 'undone':
          res.status(409).json({ error: 'That one was undone, so nothing was sent.' });
          return;
        default:
          res.status(404).json({ error: 'Couldn’t find that closed day. Reload the page.' });
      }
    } catch (err) {
      if (handleAuthError(res, err)) return;
      serverError(res, err);
    }
  },
);

// ===========================================================================
// adminDeleteBlackout: reopen a day
// ===========================================================================
/**
 * Reopens a closed day or departure. While a closure is still in its undo
 * window this is the same as Undo: nothing was sent, and it never will be.
 * After that, cancelled bookings stay cancelled, and anyone offered a new
 * date who hasn't moved or taken the refund goes back on their original
 * trip (restoreOfferedBookings). They aren't emailed: the response lists
 * them for Travis to tell (an undo lists those it put back, too). If the
 * crew were told those trips were off, including a day Travis left
 * booked, they're told they're back on (`crewTold` says whether that
 * reached them all); a failure there is logged and doesn't stop the reopen.
 * Anyone who paid for those trips while they were closed is sent the
 * confirmation held back from them (`confirmationsSent`).
 *
 * Refused (409, naming them) while a trip it covers has left with someone
 * still booked on it (assertReopenable): reopening would count that trip
 * as having run. An undo isn't refused: it names them (`alreadyLeft`, see
 * undoClosure). Nor is a retried reopen whose blackout is down already:
 * anyone the first try put back whose trip has left since is listed in
 * `alreadyLeft` for Travis to check on, and left out of the crew's "Back on".
 * `stillClosed`, as for an undo: another closed day still covers `all` or
 * `some` of its trips, so those aren't open for booking yet.
 */
export const adminDeleteBlackout = onRequest(
  {
    cors: false,
    secrets: [MCP_TOKEN, ...CREW_ALERT_SECRETS],
    maxInstances: 5,
  },
  async (req, res) => {
    if (applyCors(req, res)) return;
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    try {
      const admin = await requireAdmin(req, { allowMcp: true });
      const parsed = z
        .object({ blackoutId: z.string().min(1).max(64) })
        .safeParse(req.body);
      if (!parsed.success) return badRequest(res, 'Invalid input', parsed.error.format());
      const { blackoutId } = parsed.data;

      const action = await db.collection('closureActions').doc(blackoutId).get();
      if (action.exists) {
        const outcome = await undoClosure(blackoutId, admin, { audit: writeAudit }, 'reopen');
        if (outcome.kind === 'undone') {
          const crewTold = await tellCrewBackOn(blackoutId, outcome.restored);
          const confirmations = await confirmHeldBack(blackoutId, outcome.action);
          res.status(200).json({
            ok: true,
            undone: true,
            restored: outcome.restored,
            ...(crewTold !== null && { crewTold }),
            ...confirmations,
            ...(outcome.alreadyLeft.length > 0 && { alreadyLeft: outcome.alreadyLeft }),
            ...(outcome.stillClosed && { stillClosed: outcome.stillClosed }),
          });
          return;
        }
        if (outcome.kind === 'too-late' && outcome.state === 'finalizing') {
          res.status(409).json({ error: 'That day’s closing is going out right now. Try again in a minute.' });
          return;
        }
      }

      // For the log; a retry after the blackout went has it on the action.
      const blackoutRef = db.collection('blackouts').doc(blackoutId);
      const blackout = (await blackoutRef.get()).data() as Blackout | undefined;
      const closed = (action.data() as ClosureAction | undefined) ?? blackout;
      const date = blackout?.date ?? closed?.date ?? null;
      if (blackout) await assertReopenable(blackoutId, blackout);
      // Before the blackout goes, so a reopen that fails partway leaves the
      // day closed and listed, to reopen again.
      const { back: restored, alreadyLeft } = splitLeft(await restoreOfferedBookings(blackoutId));
      await blackoutRef.delete();
      // A day closed from MCP has only the blackout to say what it closed.
      const crewTold = await tellCrewBackOn(blackoutId, restored, action.exists ? undefined : blackout);
      const confirmations = await confirmHeldBack(blackoutId, closed);
      const stillClosed = closed ? await findStillClosed(blackoutId, closed) : null;
      await writeAudit({
        admin,
        action: 'blackout.delete',
        targetId: blackoutId,
        payload: {
          date,
          restoredBookingIds: restored.map((r) => r.id),
          ...(alreadyLeft.length > 0 && { alreadyLeftBookingIds: alreadyLeft.map((r) => r.id) }),
          ...(crewTold !== null && { crewTold }),
        },
      });
      res.status(200).json({
        ok: true,
        restored,
        ...(crewTold !== null && { crewTold }),
        ...confirmations,
        ...(alreadyLeft.length > 0 && { alreadyLeft }),
        ...(stillClosed && { stillClosed }),
      });
    } catch (err) {
      if (handleAuthError(res, err)) return;
      if (handleClosureError(res, err)) return;
      serverError(res, err);
    }
  },
);

// ===========================================================================
// finalizeClosures: every minute, run the closures whose undo window is up.
// ===========================================================================
export const finalizeClosures = onSchedule(
  {
    schedule: 'every 1 minutes',
    timeZone: 'America/New_York',
    region: 'us-central1',
    secrets: CLOSE_DAY_SECRETS,
    retryCount: 0,
    timeoutSeconds: 300,
  },
  async () => {
    const result = await finalizeDueClosures(finalizeDeps());
    if (result.finalized.length) logger.info('Finalized closed days', result);
    if (result.failed.length) logger.error('Some closed days weren’t finalized; the next run retries them', result);
  },
);

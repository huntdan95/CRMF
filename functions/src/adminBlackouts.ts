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
  confirmClosure,
  finalizeClosure,
  finalizeDueClosures,
  previewClosure,
  undoClosure,
  type CrewAlertSender,
  type FinalizeDeps,
} from './lib/close-day';
import { isRealDate } from './lib/datetime';
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
import type { ClosureAction } from './lib/types';

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
    audit: writeAudit,
  };
}

/** Everything closing a day can touch: refunds, customer and crew emails, crew push. */
const CLOSE_DAY_SECRETS = [STRIPE_SECRET_KEY, RESEND_API_KEY, RESEND_FROM_EMAIL, APP_BASE_URL, VAPID_PRIVATE_KEY];

/** Closing a day with people booked can refund them: never through MCP. */
async function requireSiteAdmin(req: Parameters<typeof requireAdmin>[0]): Promise<AdminContext> {
  return requireAdmin(req);
}

// ===========================================================================
// adminCreateBlackout: stop new bookings, nothing else.
// ===========================================================================
/**
 * Closes departures to new bookings and does nothing to the people already
 * booked. The MCP endpoint's create_blackout uses it. Closing a day from
 * the admin site goes through adminPreviewClosure / adminConfirmClosure,
 * which can cancel or email the people booked, with a review step and an
 * undo window first.
 */
export const adminCreateBlackout = onRequest(
  {
    cors: false,
    secrets: [MCP_TOKEN],
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

      const ref = await db.collection('blackouts').add({
        date: parsed.data.date,
        affectedSlots: parsed.data.affectedSlots,
        reason: parsed.data.reason ?? null,
        notes: parsed.data.notes ?? null,
        createdAt: FieldValue.serverTimestamp(),
      });

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
        },
      });

      res.status(200).json({ ok: true, blackoutId: ref.id, cancelledBookingIds: [] });
    } catch (err) {
      if (handleAuthError(res, err)) return;
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
export const adminUndoClosure = onRequest(
  { cors: false, maxInstances: 5 },
  async (req, res) => {
    if (applyCors(req, res)) return;
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    try {
      const admin = await requireSiteAdmin(req);
      const parsed = z.object({ blackoutId: z.string().min(1).max(64) }).safeParse(req.body);
      if (!parsed.success) return badRequest(res, 'Invalid input', parsed.error.format());
      const outcome = await undoClosure(parsed.data.blackoutId, admin, { audit: writeAudit });
      switch (outcome.kind) {
        case 'undone':
        case 'already-undone':
          res.status(200).json({ ok: true });
          return;
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
 * After that, cancelled bookings stay cancelled and anyone offered a new
 * date still gets to choose.
 */
export const adminDeleteBlackout = onRequest(
  { cors: false, secrets: [MCP_TOKEN], maxInstances: 5 },
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
          res.status(200).json({ ok: true, undone: true });
          return;
        }
        if (outcome.kind === 'too-late' && outcome.state === 'finalizing') {
          res.status(409).json({ error: 'That day’s closing is going out right now. Try again in a minute.' });
          return;
        }
      }

      await db.collection('blackouts').doc(blackoutId).delete();
      await writeAudit({
        admin,
        action: 'blackout.delete',
        targetId: blackoutId,
      });
      res.status(200).json({ ok: true });
    } catch (err) {
      if (handleAuthError(res, err)) return;
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

import { onRequest } from 'firebase-functions/v2/https';
import { z } from 'zod';

import {
  STRIPE_SECRET_KEY,
  getStripe,
} from './lib/stripe';
import { db } from './lib/firebase';
import { RESEND_API_KEY, RESEND_FROM_EMAIL } from './lib/resend';
import { APP_BASE_URL, MCP_TOKEN } from './lib/config';
import { sendUpdatedConfirmation } from './lib/send-confirmation';
import { adminCancelOne, keepRefusedCancelRefund, stripeRefusedRefund } from './lib/admin-cancel';
import { customerMailer } from './lib/customer-mailer';
import { adminPartialRefundOne } from './lib/admin-refund';
import { NOTE_MAX, adminEditOne, saveAdminNote } from './lib/admin-edit';
import { adminRescheduleOne, emailMovedBooking } from './lib/admin-reschedule';
import { adminMarkOne } from './lib/admin-mark';
import { adminResendOne } from './lib/admin-resend';
import { adminManualRefundOne } from './lib/admin-manual-refund';
import { adminResetLinksOne, resetLinksPaths } from './lib/admin-reset-links';
import { NO_WETSUIT, getAutomationSettings, wetsuitChoices, wetsuitSizeValues } from './lib/site-settings';
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
} from './lib/admin-auth';
import type { Booking } from './lib/types';

const COMMON_SECRETS = [
  STRIPE_SECRET_KEY,
  RESEND_API_KEY,
  RESEND_FROM_EMAIL,
  APP_BASE_URL,
];

const bookingIdSchema = z.object({ bookingId: z.string().min(1).max(64) });

async function loadBooking(bookingId: string): Promise<Booking | null> {
  const snap = await db.collection('bookings').doc(bookingId).get();
  if (!snap.exists) return null;
  return snap.data() as Booking;
}

/** For a booking whose online payment hasn't gone through (adminEditOne, adminRescheduleOne). */
const STILL_PAYING = 'The customer is still paying for this booking online. Change it once the payment has gone through, or cancel it.';

function ok(res: import('express').Response, body: Record<string, unknown> = {}) {
  res.status(200).json({ ok: true, ...body });
}

function handleAuthError(res: import('express').Response, err: unknown): boolean {
  if (err instanceof AdminAuthError) {
    res.status(err.status).json({ error: err.message });
    return true;
  }
  return false;
}

// ===========================================================================
// adminCancelBooking — full refund regardless of policy. If Stripe turns the
// refund down, nothing changes (a 409, code `refund-refused`), and from then
// on the booking can be cancelled with `refundHandledInStripe`: no refund
// from here, what was owed recorded as given back in Stripe.
// ===========================================================================
export const adminCancelBooking = onRequest(
  { cors: false, secrets: COMMON_SECRETS, maxInstances: 5 },
  async (req, res) => {
    if (applyCors(req, res)) return;
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    try {
      const admin = await requireAdmin(req);
      const parsed = bookingIdSchema
        .extend({
          reason: z.string().trim().max(500).optional(),
          notifyCustomer: z.boolean().optional(),
          refundHandledInStripe: z.boolean().optional(),
        })
        .safeParse(req.body);
      if (!parsed.success) return badRequest(res, 'Invalid input', parsed.error.format());

      let result: Awaited<ReturnType<typeof adminCancelOne>>;
      try {
        result = await adminCancelOne(
          parsed.data.bookingId,
          {
            reason: parsed.data.reason ?? null,
            notifyCustomer: parsed.data.notifyCustomer,
            cause: 'admin',
            refundHandledInStripe: parsed.data.refundHandledInStripe,
          },
          { stripe: getStripe(), mailer: customerMailer({ adminEmail: admin.email }) },
        );
      } catch (err) {
        if (!stripeRefusedRefund(err)) throw err;
        // A disputed payment, say: trying again gets the same answer. Kept
        // on the booking, so its Cancel offers "refund handled in Stripe".
        const kept = await keepRefusedCancelRefund(parsed.data.bookingId, err.message);
        if (kept === 'not-found') {
          res.status(404).json({ error: 'Booking not found' });
          return;
        }
        if (kept === 'already-cancelled') return ok(res, { alreadyCancelled: true });
        res.status(409).json({
          error: `Stripe turned the refund down: “${err.message}” Nothing was cancelled or refunded.`,
          code: 'refund-refused',
          stripeMessage: err.message,
        });
        return;
      }

      switch (result.kind) {
        case 'not-found':
          res.status(404).json({ error: 'Booking not found' });
          return;
        case 'already-cancelled':
          // Cancelled another way just as Stripe took this refund: it
          // stands, so it's logged, and Travis is told.
          if (result.stripeRefundId) {
            await writeAudit({
              admin,
              action: 'booking.refund',
              targetId: parsed.data.bookingId,
              payload: { refundCents: result.refundCents, stripeRefundId: result.stripeRefundId, alreadyCancelled: true, reason: parsed.data.reason ?? null },
            });
          }
          return ok(res, { alreadyCancelled: true, refundCents: result.refundCents, stripeRefundId: result.stripeRefundId });
        case 'changed': // moved meanwhile, taking the refusal with its closure
          res.status(409).json({ error: 'This booking just changed. Reload the page to see where it stands.' });
          return;
        case 'no-refused-refund':
          res.status(409).json({
            error: 'Stripe hasn’t turned down a refund for this booking, so cancel it the usual way to refund them.',
          });
          return;
        case 'not-active':
          res.status(409).json({ error: `This booking is ${result.status === 'no-show' ? 'marked as a no-show' : result.status}, so it can’t be cancelled.` });
          return;
        case 'paid-meanwhile':
          res.status(409).json({ error: 'They paid a moment ago. Reload the page, then cancel again so their payment is refunded.' });
          return;
      }

      await writeAudit({
        admin,
        action: 'booking.cancel',
        targetId: parsed.data.bookingId,
        payload: {
          refundCents: result.refundCents,
          manualRefundCents: result.manualRefundCents,
          stripeRefundId: result.stripeRefundId,
          emailed: result.emailed,
          reason: parsed.data.reason ?? null,
          ...(parsed.data.refundHandledInStripe
            ? { refundHandledInStripe: true, handledInStripeCents: result.handledInStripeCents }
            : {}),
        },
      });

      return ok(res, {
        refundCents: result.refundCents,
        manualRefundCents: result.manualRefundCents,
        handledInStripeCents: result.handledInStripeCents,
        stripeRefundId: result.stripeRefundId,
        emailed: result.emailed,
        emailFailed: result.emailFailed,
      });
    } catch (err) {
      if (handleAuthError(res, err)) return;
      serverError(res, err);
    }
  },
);

// ===========================================================================
// adminPartialRefund — refund an admin-entered amount, booking stays active
// ===========================================================================
export const adminPartialRefund = onRequest(
  { cors: false, secrets: COMMON_SECRETS, maxInstances: 5 },
  async (req, res) => {
    if (applyCors(req, res)) return;
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    try {
      const admin = await requireAdmin(req);
      const parsed = bookingIdSchema
        .extend({
          amountCents: z.number().int().min(1),
          // Made once per refund window and sent with every try. Optional
          // only so a page loaded before this change gets a clear message.
          requestId: z.string().uuid().optional(),
          reason: z.string().trim().max(500).optional(),
        })
        .safeParse(req.body);
      if (!parsed.success) return badRequest(res, 'Invalid input', parsed.error.format());
      const { bookingId, amountCents, requestId, reason } = parsed.data;
      if (!requestId) {
        return badRequest(res, 'This page is out of date. Reload it, then refund again.');
      }

      const result = await adminPartialRefundOne(
        bookingId,
        { amountCents, requestId, adminEmail: admin.email },
        { stripe: getStripe() },
      );

      switch (result.kind) {
        case 'not-found':
          res.status(404).json({ error: 'Booking not found' });
          return;
        case 'no-stripe-payment':
          return badRequest(res, 'Booking has no Stripe payment to refund against.');
        case 'too-much':
          return badRequest(
            res,
            `Can refund at most $${(result.refundableCents / 100).toFixed(2)} more.`,
          );
        case 'key-reused':
          res.status(409).json({
            error: 'This refund already went to Stripe. Close this window and reload the booking to see what was refunded.',
          });
          return;
      }

      if (!result.repeat) {
        await writeAudit({
          admin,
          action: 'booking.refund',
          targetId: bookingId,
          payload: {
            refundCents: result.refundCents,
            stripeRefundId: result.stripeRefundId,
            reason: reason ?? null,
          },
        });
      }

      return ok(res, { stripeRefundId: result.stripeRefundId, refundCents: result.refundCents });
    } catch (err) {
      if (handleAuthError(res, err)) return;
      serverError(res, err);
    }
  },
);

// ===========================================================================
// adminEditBooking — change guest count, customer/emergency contact, ages
// ===========================================================================
export const adminEditBooking = onRequest(
  { cors: false, secrets: [APP_BASE_URL, MCP_TOKEN], maxInstances: 5 },
  async (req, res) => {
    if (applyCors(req, res)) return;
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    try {
      const admin = await requireAdmin(req, { allowMcp: true });
      const parsed = bookingIdSchema
        .extend({
          guestCount: z.number().int().min(1).max(6).optional(),
          guests: z
            .array(
              z.object({
                name: z.string().trim().max(120),
                age: z.number().int().min(0).max(120).nullable(),
                wetsuitSize: z.string().trim().max(20).nullable().optional(),
              }),
            )
            .optional(),
          customerName: z.string().trim().max(120).optional(),
          customerEmail: z.string().email().max(160).optional(),
          customerPhone: z.string().trim().max(40).optional(),
          emergencyContactName: z.string().trim().max(120).optional(),
          emergencyContactPhone: z.string().trim().max(40).optional(),
        })
        .safeParse(req.body);
      if (!parsed.success) return badRequest(res, 'Invalid input', parsed.error.format());

      const { bookingId, ...edit } = parsed.data;
      // The customer's links (manage, cancel, refund) go to this address, so
      // the MCP token, which can't refund, mustn't be able to redirect them.
      if (edit.customerEmail !== undefined && admin.via === 'mcp') {
        res.status(403).json({ error: 'The customer’s email address can only be changed on the admin site.' });
        return;
      }

      if (edit.guests) {
        const current = await loadBooking(bookingId);
        if (!current) {
          res.status(404).json({ error: 'Booking not found' });
          return;
        }
        const had = current.guests.map((g) => g.wetsuitSize).filter((s): s is string => !!s);
        // A wetsuit size has to be stocked (or "not swimming"), or one the
        // booking already had (a size Travis has since stopped listing).
        if (edit.guests.some((g) => g.wetsuitSize)) {
          const sizes = (await getAutomationSettings()).wetsuitSizes;
          const allowed = new Set([...wetsuitChoices(sizes), ...had]);
          const bad = edit.guests.find((g) => g.wetsuitSize && !allowed.has(g.wetsuitSize));
          // The choices, as they're saved: MCP has no dropdown to pick from.
          if (bad) {
            return badRequest(
              res,
              `${bad.wetsuitSize} isn’t one of your wetsuit sizes. Pick one from the list: ${wetsuitSizeValues(sizes).join(', ')}, or ${NO_WETSUIT} for someone not swimming.`,
            );
          }
        }
        // Firestore refuses undefined. A guest sent without a size (an admin
        // page from before sizes) keeps the one they had.
        edit.guests = edit.guests.map((g, i) => ({
          name: g.name,
          age: g.age,
          wetsuitSize:
            g.wetsuitSize !== undefined ? g.wetsuitSize || null : (current.guests[i]?.wetsuitSize ?? null),
        }));
      }

      const result = await adminEditOne(bookingId, edit);

      switch (result.kind) {
        case 'nothing-to-update':
          return badRequest(res, 'Nothing to update.');
        case 'not-found':
          res.status(404).json({ error: 'Booking not found' });
          return;
        case 'still-paying':
          res.status(409).json({ error: STILL_PAYING });
          return;
        case 'tour-missing':
          return badRequest(res, 'Tour record missing.');
        case 'slot-full':
          res.status(409).json({ error: result.message, reason: 'slot-shared-full' });
          return;
      }

      await writeAudit({
        admin,
        action: 'booking.update',
        targetId: bookingId,
        payload: { before: result.before, after: result.after },
      });

      return ok(res);
    } catch (err) {
      if (handleAuthError(res, err)) return;
      serverError(res, err);
    }
  },
);

// ===========================================================================
// adminRescheduleBooking — move to a different date/slot. Capacity-checked.
// Price difference handled out-of-band for v1 (manifest by Travis manually
// to issue partial refund / send a top-up link).
// ===========================================================================
export const adminRescheduleBooking = onRequest(
  { cors: false, secrets: [...COMMON_SECRETS, MCP_TOKEN], maxInstances: 5 },
  async (req, res) => {
    if (applyCors(req, res)) return;
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    try {
      const admin = await requireAdmin(req, { allowMcp: true });
      const parsed = bookingIdSchema
        .extend({
          newDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          newTourSlug: z.string().min(1).max(64),
          notifyCustomer: z.boolean().default(true),
        })
        .safeParse(req.body);
      if (!parsed.success) return badRequest(res, 'Invalid input', parsed.error.format());

      const { bookingId, newDate, newTourSlug } = parsed.data;
      const result = await adminRescheduleOne(bookingId, { newDate, newTourSlug });

      switch (result.kind) {
        case 'invalid-date':
          return badRequest(res, `${newDate} isn’t a date on the calendar.`);
        case 'past':
          res.status(409).json({ error: 'Pick a date that hasn’t passed yet.' });
          return;
        case 'not-found':
          res.status(404).json({ error: 'Booking not found' });
          return;
        case 'not-active':
          return badRequest(res, 'Only active bookings can be rescheduled.');
        case 'still-paying':
          res.status(409).json({ error: STILL_PAYING });
          return;
        case 'no-party-size':
          res.status(409).json({ error: 'Set how many guests are coming first (Edit guests or contact details), then move the booking onto a shared tour.' });
          return;
        case 'tour-missing':
          return badRequest(res, 'New tour not found.');
        case 'changed':
          res.status(409).json({ error: 'This booking was cancelled or moved a moment ago. Reload the page to see where it stands.' });
          return;
        case 'unavailable':
          res.status(409).json({ error: result.message, reason: result.reason });
          return;
      }

      const email = await emailMovedBooking(result.booking, parsed.data.notifyCustomer, (b) =>
        sendUpdatedConfirmation(b, { adminEmail: admin.email }),
      );

      await writeAudit({
        admin,
        action: 'booking.reschedule',
        targetId: bookingId,
        payload: {
          before: result.before,
          after: {
            date: newDate,
            tourSlug: newTourSlug,
          },
          emailed: email.emailed,
        },
      });

      return ok(res, email);
    } catch (err) {
      if (handleAuthError(res, err)) return;
      serverError(res, err);
    }
  },
);

// ===========================================================================
// adminMarkBooking — no-show / completed
// ===========================================================================
export const adminMarkBooking = onRequest(
  { cors: false, secrets: [MCP_TOKEN], maxInstances: 5 },
  async (req, res) => {
    if (applyCors(req, res)) return;
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    try {
      const admin = await requireAdmin(req, { allowMcp: true });
      const parsed = bookingIdSchema
        .extend({ status: z.enum(['completed', 'no-show']), ranAnyway: z.boolean().optional() })
        .safeParse(req.body);
      if (!parsed.success) return badRequest(res, 'Invalid input', parsed.error.format());

      // A trip on a departure Travis closed that went out after all: only
      // from the admin booking page, which asks him first (adminMarkOne).
      const ranAnyway = parsed.data.ranAnyway === true && admin.via !== 'mcp';
      const result = await adminMarkOne(parsed.data.bookingId, parsed.data.status, { ranAnyway });
      switch (result.kind) {
        case 'not-found':
          res.status(404).json({ error: 'Booking not found' });
          return;
        case 'not-going-ahead': {
          const what =
            result.status === 'no-show'
              ? 'marked as a no-show'
              : result.status === 'pending-payment'
                ? 'not paid for'
                : result.status;
          res.status(409).json({ error: `This booking is ${what}, so it can’t be marked.` });
          return;
        }
        case 'closed':
          res.status(409).json({
            error: 'You closed this departure and the customer hasn’t picked a new date or a refund yet, so it can’t be marked. Move or cancel it instead.',
          });
          return;
        case 'departure-closed':
          res.status(409).json({
            error:
              'You closed this departure, so it can’t be marked. Move it to another day, or cancel it to refund them in full.' +
              (admin.via === 'mcp' ? ' If it went out after all, mark it from the booking’s page on the admin site.' : ''),
          });
          return;
        case 'closing':
          res.status(409).json({
            error: 'You’re still closing this departure (the undo time is open, or it’s going out right now), so it can’t be marked yet.',
          });
          return;
        case 'not-yet':
          res.status(409).json({ error: 'This tour hasn’t left yet.' });
          return;
        case 'not-back':
          res.status(409).json({ error: 'This tour is still out. Mark it completed once it’s back.' });
          return;
      }

      await writeAudit({
        admin,
        action: parsed.data.status === 'completed' ? 'booking.complete' : 'booking.no-show',
        targetId: parsed.data.bookingId,
        ...(result.closedBy && { payload: { ranAnyway: true, closedBy: result.closedBy } }),
      });
      return ok(res);
    } catch (err) {
      if (handleAuthError(res, err)) return;
      serverError(res, err);
    }
  },
);

// ===========================================================================
// adminRecordManualRefund — "Refunded by hand": old-site money owed back on
// a cancelled booking has been paid back outside this site. Admin site only
// (no MCP token): it tells the customer they've been refunded.
// ===========================================================================
export const adminRecordManualRefund = onRequest(
  { cors: false, maxInstances: 5 },
  async (req, res) => {
    if (applyCors(req, res)) return;
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    try {
      const admin = await requireAdmin(req);
      const parsed = bookingIdSchema.safeParse(req.body);
      if (!parsed.success) return badRequest(res, 'Invalid input', parsed.error.format());

      const result = await adminManualRefundOne(parsed.data.bookingId);
      switch (result.kind) {
        case 'not-found':
          res.status(404).json({ error: 'Booking not found' });
          return;
        case 'already-recorded':
          return ok(res, { alreadyRecorded: true });
        case 'nothing-owed':
          res.status(409).json({ error: 'There’s nothing to refund by hand on this booking.' });
          return;
      }

      await writeAudit({
        admin,
        action: 'booking.refund',
        targetId: parsed.data.bookingId,
        payload: { refundCents: result.manualRefundCents, byHand: true },
      });
      return ok(res);
    } catch (err) {
      if (handleAuthError(res, err)) return;
      serverError(res, err);
    }
  },
);

// ===========================================================================
// adminResetBookingLinks — "Reset their booking links": a new access token,
// so links that went to the wrong person stop working, and the customer's
// current address gets the new ones (lib/admin-reset-links.ts). Admin site
// only (no MCP token): the token is what cancels and refunds the booking.
// Audit-logged by adminResetLinksOne, with what was emailed.
// ===========================================================================
export const adminResetBookingLinks = onRequest(
  { cors: false, secrets: [RESEND_API_KEY, RESEND_FROM_EMAIL, APP_BASE_URL], maxInstances: 5 },
  async (req, res) => {
    if (applyCors(req, res)) return;
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    try {
      const admin = await requireAdmin(req);
      const parsed = bookingIdSchema.safeParse(req.body);
      if (!parsed.success) return badRequest(res, 'Invalid input', parsed.error.format());

      const result = await adminResetLinksOne(parsed.data.bookingId, admin, {
        paths: resetLinksPaths(admin.email),
      });
      switch (result.kind) {
        case 'not-found':
          res.status(404).json({ error: 'Booking not found' });
          return;
        case 'still-paying':
          res.status(409).json({
            error: 'The customer is still paying for this booking online. Reset their links once the payment has gone through.',
          });
          return;
      }
      return ok(res, { email: result.email });
    } catch (err) {
      if (handleAuthError(res, err)) return;
      serverError(res, err);
    }
  },
);

// ===========================================================================
// adminAddNote — internal note field on a booking
// ===========================================================================
export const adminAddNote = onRequest(
  { cors: false, secrets: [MCP_TOKEN], maxInstances: 5 },
  async (req, res) => {
    if (applyCors(req, res)) return;
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    try {
      const admin = await requireAdmin(req, { allowMcp: true });
      const parsed = bookingIdSchema
        .extend({
          // The whole notes text, replacing what's there. The site's own
          // lines can take it past NOTE_MAX, which caps what a save adds
          // (saveAdminNote), so this is only a sanity limit.
          note: z.string().trim().max(100_000).optional(),
          // The notes as they were when the admin note window opened; the
          // save is refused if they've changed since. Not trimmed: it's
          // compared with what's stored.
          previousNotes: z.string().max(100_000).optional(),
          // A line to add to the end instead (MCP's add_booking_note). Sent
          // without `note`, so a function from before this existed refuses
          // it rather than replacing the notes with the one line.
          append: z.string().trim().min(1).max(NOTE_MAX).optional(),
        })
        .refine((d) => (d.note === undefined) !== (d.append === undefined), {
          message: 'Send either note or append.',
        })
        .safeParse(req.body);
      if (!parsed.success) return badRequest(res, 'Invalid input', parsed.error.format());
      const { bookingId, note, previousNotes, append } = parsed.data;

      const result = await saveAdminNote(
        bookingId,
        append !== undefined ? { append } : { note: note ?? '', previousNotes },
      );
      switch (result.kind) {
        case 'not-found':
          res.status(404).json({ error: 'Booking not found' });
          return;
        case 'changed':
          res.status(409).json({
            error: 'The notes changed while you had them open. Copy what you wrote, then close this and open the notes again.',
          });
          return;
        case 'too-long':
          return badRequest(
            res,
            `That adds ${result.added} characters to the notes; ${NOTE_MAX} is the most at once. Save it in two goes.`,
          );
      }

      await writeAudit({
        admin,
        action: 'booking.note',
        targetId: bookingId,
        payload: { field: 'adminNotes', before: result.before, after: result.after },
      });
      return ok(res, { adminNotes: result.after });
    } catch (err) {
      if (handleAuthError(res, err)) return;
      serverError(res, err);
    }
  },
);

// ===========================================================================
// adminResendConfirmation — manually re-trigger the confirmation email
// ===========================================================================
export const adminResendConfirmation = onRequest(
  { cors: false, secrets: [...COMMON_SECRETS, MCP_TOKEN], maxInstances: 5 },
  async (req, res) => {
    if (applyCors(req, res)) return;
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    try {
      const admin = await requireAdmin(req, { allowMcp: true });
      const parsed = bookingIdSchema.safeParse(req.body);
      if (!parsed.success) return badRequest(res, 'Invalid input', parsed.error.format());

      const result = await adminResendOne(parsed.data.bookingId);
      switch (result.kind) {
        case 'not-found':
          res.status(404).json({ error: 'Booking not found' });
          return;
        case 'not-confirmed':
          res.status(409).json({ error: 'Only confirmed bookings get a confirmation email.' });
          return;
        case 'closed':
          res.status(409).json({
            error: 'You closed this departure, so a confirmation would tell the customer it’s still on. If you offered a new date, they have that email instead.',
          });
          return;
        case 'past':
          res.status(409).json({ error: 'This trip date has passed, so there’s nothing to confirm.' });
          return;
      }

      await writeAudit({
        admin,
        action: 'booking.update',
        targetId: parsed.data.bookingId,
        payload: { action: 'resend-confirmation' },
      });
      return ok(res);
    } catch (err) {
      if (handleAuthError(res, err)) return;
      serverError(res, err);
    }
  },
);


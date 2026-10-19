import { onRequest } from 'firebase-functions/v2/https';
import { z } from 'zod';

import {
  STRIPE_SECRET_KEY,
  getStripe,
} from './lib/stripe';
import { RESEND_API_KEY, RESEND_FROM_EMAIL } from './lib/resend';
import { APP_BASE_URL, MCP_TOKEN } from './lib/config';
import { sendUpdatedConfirmation } from './lib/send-confirmation';
import { adminCancelOne } from './lib/admin-cancel';
import { customerMailer } from './lib/customer-mailer';
import { adminPartialRefundOne } from './lib/admin-refund';
import { NOTE_MAX, adminEditOne, saveAdminNote } from './lib/admin-edit';
import { adminRescheduleOne, emailMovedBooking } from './lib/admin-reschedule';
import { adminMarkOne } from './lib/admin-mark';
import { adminResendOne } from './lib/admin-resend';
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

const COMMON_SECRETS = [
  STRIPE_SECRET_KEY,
  RESEND_API_KEY,
  RESEND_FROM_EMAIL,
  APP_BASE_URL,
];

const bookingIdSchema = z.object({ bookingId: z.string().min(1).max(64) });

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
// adminCancelBooking — full refund regardless of policy
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
        })
        .safeParse(req.body);
      if (!parsed.success) return badRequest(res, 'Invalid input', parsed.error.format());

      const result = await adminCancelOne(
        parsed.data.bookingId,
        {
          reason: parsed.data.reason ?? null,
          notifyCustomer: parsed.data.notifyCustomer,
          cause: 'admin',
        },
        { stripe: getStripe(), mailer: customerMailer({ adminEmail: admin.email }) },
      );

      switch (result.kind) {
        case 'not-found':
          res.status(404).json({ error: 'Booking not found' });
          return;
        case 'already-cancelled':
          return ok(res, { alreadyCancelled: true });
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
        },
      });

      return ok(res, {
        refundCents: result.refundCents,
        manualRefundCents: result.manualRefundCents,
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
              z.object({ name: z.string().trim().max(120), age: z.number().int().min(0).max(120).nullable() }),
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
        .extend({ status: z.enum(['completed', 'no-show']) })
        .safeParse(req.body);
      if (!parsed.success) return badRequest(res, 'Invalid input', parsed.error.format());

      const result = await adminMarkOne(parsed.data.bookingId, parsed.data.status);
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
        case 'not-yet':
          res.status(409).json({ error: 'This tour hasn’t left yet.' });
          return;
      }

      await writeAudit({
        admin,
        action: parsed.data.status === 'completed' ? 'booking.complete' : 'booking.no-show',
        targetId: parsed.data.bookingId,
      });
      return ok(res);
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
          // The whole notes text, replacing what's there.
          note: z.string().trim().max(NOTE_MAX).optional(),
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
            `That would make the notes ${result.length} characters; the limit is ${NOTE_MAX}. Tidy them on the booking page first.`,
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
            error: 'You closed this departure, so the customer has the “pick a new date” email instead. A confirmation would tell them it’s still on.',
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


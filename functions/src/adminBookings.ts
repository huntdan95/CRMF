import { onRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { z } from 'zod';

import { db, FieldValue } from './lib/firebase';
import {
  STRIPE_SECRET_KEY,
  getStripe,
} from './lib/stripe';
import { RESEND_API_KEY, RESEND_FROM_EMAIL } from './lib/resend';
import { APP_BASE_URL, MCP_TOKEN } from './lib/config';
import { marinaNow } from './lib/datetime';
import { resendBookingConfirmation, sendUpdatedConfirmation } from './lib/send-confirmation';
import { adminCancelOne } from './lib/admin-cancel';
import { customerMailer } from './lib/customer-mailer';
import { adminPartialRefundOne } from './lib/admin-refund';
import { NOTE_MAX, adminEditOne, saveAdminNote } from './lib/admin-edit';
import { adminRescheduleOne } from './lib/admin-reschedule';
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
        case 'no-party-size':
          res.status(409).json({ error: 'Set how many guests are coming first (Edit guests or contact details), then move the booking.' });
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

      // The confirmation template says "locked in" and shows what was paid:
      // only true for a confirmed booking. Checked on the booking as the
      // move read it, not as it was before.
      if (parsed.data.notifyCustomer && result.booking.status === 'confirmed') {
        try {
          await sendUpdatedConfirmation(result.booking, { adminEmail: admin.email });
        } catch (err) {
          logger.error('Reschedule notification email failed', { err });
        }
      }

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
        },
      });

      return ok(res);
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

      const ref = db.collection('bookings').doc(parsed.data.bookingId);
      const snap = await ref.get();
      if (!snap.exists) {
        res.status(404).json({ error: 'Booking not found' });
        return;
      }
      // There's no undo, and marking frees the seats, so only a confirmed
      // booking whose tour day has come can be marked.
      const current = snap.data() as Booking;
      if (current.status !== 'confirmed') {
        res.status(409).json({ error: `This booking is ${current.status}, so it can’t be marked.` });
        return;
      }
      if (current.date > marinaNow().date) {
        res.status(409).json({ error: 'This tour hasn’t happened yet.' });
        return;
      }

      await ref.update({
        status: parsed.data.status,
        updatedAt: FieldValue.serverTimestamp(),
      });
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

      const booking = await loadBooking(parsed.data.bookingId);
      if (!booking) {
        res.status(404).json({ error: 'Booking not found' });
        return;
      }
      // sendBookingConfirmation quietly skips anything else; say so instead
      // of reporting an email that never went out.
      if (booking.status !== 'confirmed') {
        res.status(409).json({ error: 'Only confirmed bookings get a confirmation email.' });
        return;
      }

      // Clears the sent-marker so sendBookingConfirmation will re-send.
      await resendBookingConfirmation(parsed.data.bookingId);

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


import { onRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { z } from 'zod';

import { db, FieldValue } from './lib/firebase';
import {
  STRIPE_SECRET_KEY,
  getStripe,
} from './lib/stripe';
import {
  RESEND_API_KEY,
  RESEND_FROM_EMAIL,
  getResend,
  getFromAddress,
} from './lib/resend';
import { APP_BASE_URL, MCP_TOKEN } from './lib/config';
import { getTourBySlug } from './lib/tours';
import { AvailabilityError } from './lib/availability';
import { marinaNow } from './lib/datetime';
import { buildBookingConfirmation } from './lib/email-templates';
import { sendBookingConfirmation } from './lib/send-confirmation';
import { adminCancelOne, type CancellationMailer } from './lib/admin-cancel';
import { adminPartialRefundOne } from './lib/admin-refund';
import { adminEditOne } from './lib/admin-edit';
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

const MARINA = {
  name: "Pete's Pier Marina",
  address: '1 SW First Place, Crystal River, FL 34429',
};
const PHONE_DISPLAY = '352-586-7792';
const COMMON_SECRETS = [
  STRIPE_SECRET_KEY,
  RESEND_API_KEY,
  RESEND_FROM_EMAIL,
  APP_BASE_URL,
];

const bookingIdSchema = z.object({ bookingId: z.string().min(1).max(64) });

/** Customer emails go out from the site, copied to Travis, replies to him. */
function resendMailer(adminEmail: string): CancellationMailer {
  return {
    marina: MARINA,
    phoneDisplay: PHONE_DISPLAY,
    async send({ to, subject, html, text, bookingId }) {
      // Resend reports a refused email in `error` rather than throwing; throw
      // so the booking is reported as not emailed.
      const { error } = await getResend().emails.send({
        from: getFromAddress(),
        to: [to],
        bcc: [adminEmail],
        subject,
        html,
        text,
        replyTo: adminEmail,
        headers: { 'X-Entity-Ref-ID': bookingId },
      });
      if (error) throw new Error(`Resend failed: ${error.message ?? 'unknown'}`);
    },
  };
}

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
        { stripe: getStripe(), mailer: resendMailer(admin.email) },
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

      const booking = await loadBooking(parsed.data.bookingId);
      if (!booking) {
        res.status(404).json({ error: 'Booking not found' });
        return;
      }
      if (booking.status !== 'confirmed' && booking.status !== 'pending-payment') {
        return badRequest(res, 'Only active bookings can be rescheduled.');
      }
      if (parsed.data.newDate < marinaNow().date) {
        res.status(409).json({ error: 'Pick a date that hasn’t passed yet.' });
        return;
      }
      // A booking with no party size takes no seats in the capacity check,
      // so it could be moved onto a full boat.
      if (booking.guestCount < 1) {
        res.status(409).json({ error: 'Set how many guests are coming first (Edit guests or contact details), then move the booking.' });
        return;
      }
      const newTour = await getTourBySlug(parsed.data.newTourSlug);
      if (!newTour) return badRequest(res, 'New tour not found.');

      const before = {
        date: booking.date,
        timeSlot: booking.timeSlot,
        tourId: booking.tourId,
        tourName: booking.tourName,
        type: booking.type,
      };

      try {
        await db.runTransaction(async (tx) => {
          // Custom availability check that excludes the current booking.
          const snap = await tx.get(
            db.collection('bookings').where('date', '==', parsed.data.newDate),
          );
          const blackoutSnap = await tx.get(
            db.collection('blackouts').where('date', '==', parsed.data.newDate),
          );
          const others = snap.docs
            .map((d) => d.data() as Booking)
            .filter(
              (b) =>
                b.id !== booking.id &&
                (b.status === 'pending-payment' || b.status === 'confirmed'),
            );
          // Reuse the rule logic via a freshly-constructed "virtual" booking.
          const dayBlackedOut = blackoutSnap.docs.some((d) =>
            (d.data().affectedSlots as string[]).includes('all'),
          );
          if (dayBlackedOut) {
            throw new AvailabilityError(
              'blackout-day',
              `${parsed.data.newDate} is blacked out.`,
            );
          }
          const slotBlackedOut = blackoutSnap.docs.some((d) =>
            (d.data().affectedSlots as string[]).includes(newTour.timeSlot),
          );
          if (slotBlackedOut) {
            throw new AvailabilityError(
              'blackout-slot',
              `The ${newTour.timeSlot} slot is blacked out for ${parsed.data.newDate}.`,
            );
          }
          if (others.some((b) => b.timeSlot === 'whole-day')) {
            throw new AvailabilityError(
              'whole-day-booked',
              'Day is taken by a whole-day private booking.',
            );
          }
          if (newTour.timeSlot === 'whole-day' && others.length > 0) {
            throw new AvailabilityError(
              'whole-day-booked',
              'Day already has other bookings; whole-day private requires an empty calendar.',
            );
          }
          const slotBookings = others.filter((b) => b.timeSlot === newTour.timeSlot);
          if (slotBookings.some((b) => b.type === 'private')) {
            throw new AvailabilityError(
              'slot-private-booked',
              'Slot already booked privately.',
            );
          }
          if (newTour.type === 'private' && slotBookings.length > 0) {
            throw new AvailabilityError(
              'slot-private-conflict',
              "Can't move to private — shared bookings exist for that slot.",
            );
          }
          if (newTour.type === 'shared') {
            const used = slotBookings.reduce((s, b) => s + b.guestCount, 0);
            if (used + booking.guestCount > newTour.maxGuests) {
              throw new AvailabilityError(
                'slot-shared-full',
                `Only ${newTour.maxGuests - used} spots left in that slot — your booking has ${booking.guestCount} guests.`,
              );
            }
          }

          tx.update(db.collection('bookings').doc(booking.id), {
            date: parsed.data.newDate,
            timeSlot: newTour.timeSlot,
            tourId: newTour.slug,
            tourName: newTour.name,
            type: newTour.type,
            // A booking on a day Travis closed is settled by moving it: it
            // no longer waits on the customer or gets refunded later.
            closure: FieldValue.delete(),
            updatedAt: FieldValue.serverTimestamp(),
          });
        });
      } catch (err) {
        if (err instanceof AvailabilityError) {
          res.status(409).json({ error: err.message, reason: err.reason });
          return;
        }
        throw err;
      }

      // The confirmation template says "locked in" and shows what was paid:
      // only true for a confirmed booking.
      if (parsed.data.notifyCustomer && booking.status === 'confirmed') {
        try {
          const refreshed = (await loadBooking(parsed.data.bookingId))!;
          const baseUrl = APP_BASE_URL.value();
          const { subject, html, text } = buildBookingConfirmation({
            booking: refreshed,
            baseUrl,
            marina: MARINA,
            phoneDisplay: PHONE_DISPLAY,
          });
          const { error } = await getResend().emails.send({
            from: getFromAddress(),
            to: [refreshed.customerEmail],
            bcc: [admin.email],
            subject: `Updated: ${subject}`,
            html,
            text,
            replyTo: admin.email,
            headers: { 'X-Entity-Ref-ID': parsed.data.bookingId },
          });
          if (error) throw new Error(`Resend failed: ${error.message ?? 'unknown'}`);
        } catch (err) {
          logger.error('Reschedule notification email failed', { err });
        }
      }

      await writeAudit({
        admin,
        action: 'booking.reschedule',
        targetId: parsed.data.bookingId,
        payload: {
          before,
          after: {
            date: parsed.data.newDate,
            tourSlug: parsed.data.newTourSlug,
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
        .extend({ note: z.string().trim().max(2000) })
        .safeParse(req.body);
      if (!parsed.success) return badRequest(res, 'Invalid input', parsed.error.format());

      const ref = db.collection('bookings').doc(parsed.data.bookingId);
      const snap = await ref.get();
      if (!snap.exists) {
        res.status(404).json({ error: 'Booking not found' });
        return;
      }
      const before = (snap.data() as Booking).adminNotes;

      await ref.update({
        adminNotes: parsed.data.note,
        updatedAt: FieldValue.serverTimestamp(),
      });
      await writeAudit({
        admin,
        action: 'booking.note',
        targetId: parsed.data.bookingId,
        payload: { field: 'adminNotes', before, after: parsed.data.note },
      });
      return ok(res);
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

      // Clear the sent-marker so sendBookingConfirmation will re-send.
      await db.collection('bookings').doc(parsed.data.bookingId).update({
        confirmationEmailSentAt: null,
      });
      await sendBookingConfirmation(parsed.data.bookingId);

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


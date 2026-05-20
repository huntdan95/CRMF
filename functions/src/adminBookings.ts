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
import { APP_BASE_URL } from './lib/config';
import { getTourBySlug } from './lib/tours';
import { AvailabilityError } from './lib/availability';
import {
  buildBookingConfirmation,
  buildCancellationEmail,
} from './lib/email-templates';
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
        .extend({ reason: z.string().trim().max(500).optional() })
        .safeParse(req.body);
      if (!parsed.success) return badRequest(res, 'Invalid input', parsed.error.format());

      const booking = await loadBooking(parsed.data.bookingId);
      if (!booking) {
        res.status(404).json({ error: 'Booking not found' });
        return;
      }
      if (booking.status === 'cancelled') {
        return ok(res, { alreadyCancelled: true });
      }

      // Full-refund the original amount (less any prior refund).
      const owed = Math.max(
        0,
        booking.amountPaidCents - (booking.amountRefundedCents ?? 0),
      );
      let refundId: string | null = null;
      if (owed > 0 && booking.stripePaymentIntentId) {
        const refund = await getStripe().refunds.create(
          {
            payment_intent: booking.stripePaymentIntentId,
            amount: owed,
            reason: 'requested_by_customer',
            metadata: {
              bookingId: parsed.data.bookingId,
              cancelledBy: 'admin',
              policyTier: 'full',
            },
          },
          { idempotencyKey: `admin-cancel-${parsed.data.bookingId}` },
        );
        refundId = refund.id;
      }

      await db.runTransaction(async (tx) => {
        const fresh = (await tx.get(
          db.collection('bookings').doc(parsed.data.bookingId),
        )).data() as Booking;
        if (fresh.status === 'cancelled') return;
        tx.update(db.collection('bookings').doc(parsed.data.bookingId), {
          status: 'cancelled',
          paymentStatus:
            owed === 0
              ? fresh.paymentStatus
              : owed === fresh.amountPaidCents
                ? 'refunded'
                : 'partial-refund',
          amountRefundedCents:
            (fresh.amountRefundedCents ?? 0) + owed,
          cancellationReason: parsed.data.reason ?? null,
          cancelledAt: FieldValue.serverTimestamp(),
          cancelledBy: 'admin',
          updatedAt: FieldValue.serverTimestamp(),
        });
      });

      // Email customer
      try {
        const refreshed = (await loadBooking(parsed.data.bookingId))!;
        const { subject, html, text } = buildCancellationEmail({
          booking: refreshed,
          refundCents: owed,
          refundPercent: 100,
          cancelledBy: 'admin',
          reason: parsed.data.reason,
          marina: MARINA,
          phoneDisplay: PHONE_DISPLAY,
        });
        await getResend().emails.send({
          from: getFromAddress(),
          to: [refreshed.customerEmail],
          bcc: [admin.email],
          subject,
          html,
          text,
          replyTo: admin.email,
          headers: { 'X-Entity-Ref-ID': parsed.data.bookingId },
        });
      } catch (err) {
        logger.error('Admin cancellation email failed', { bookingId: parsed.data.bookingId, err });
      }

      await writeAudit({
        admin,
        action: 'booking.cancel',
        targetId: parsed.data.bookingId,
        payload: {
          refundCents: owed,
          stripeRefundId: refundId,
          reason: parsed.data.reason ?? null,
        },
      });

      return ok(res, { refundCents: owed, stripeRefundId: refundId });
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
          reason: z.string().trim().max(500).optional(),
        })
        .safeParse(req.body);
      if (!parsed.success) return badRequest(res, 'Invalid input', parsed.error.format());

      const booking = await loadBooking(parsed.data.bookingId);
      if (!booking) {
        res.status(404).json({ error: 'Booking not found' });
        return;
      }
      if (!booking.stripePaymentIntentId) {
        return badRequest(res, 'Booking has no Stripe payment to refund against.');
      }

      const refundable =
        booking.amountPaidCents - (booking.amountRefundedCents ?? 0);
      if (parsed.data.amountCents > refundable) {
        return badRequest(
          res,
          `Can refund at most $${(refundable / 100).toFixed(2)} more.`,
        );
      }

      const refund = await getStripe().refunds.create(
        {
          payment_intent: booking.stripePaymentIntentId,
          amount: parsed.data.amountCents,
          reason: 'requested_by_customer',
          metadata: {
            bookingId: parsed.data.bookingId,
            refundType: 'partial',
            adminEmail: admin.email,
          },
        },
        {
          idempotencyKey: `partial-${parsed.data.bookingId}-${Date.now()}`,
        },
      );

      const newRefunded = (booking.amountRefundedCents ?? 0) + parsed.data.amountCents;
      await db.collection('bookings').doc(parsed.data.bookingId).update({
        amountRefundedCents: newRefunded,
        paymentStatus:
          newRefunded === booking.amountPaidCents ? 'refunded' : 'partial-refund',
        updatedAt: FieldValue.serverTimestamp(),
      });

      await writeAudit({
        admin,
        action: 'booking.refund',
        targetId: parsed.data.bookingId,
        payload: {
          refundCents: parsed.data.amountCents,
          stripeRefundId: refund.id,
          reason: parsed.data.reason ?? null,
        },
      });

      return ok(res, { stripeRefundId: refund.id, refundCents: parsed.data.amountCents });
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
  { cors: false, secrets: [APP_BASE_URL], maxInstances: 5 },
  async (req, res) => {
    if (applyCors(req, res)) return;
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    try {
      const admin = await requireAdmin(req);
      const parsed = bookingIdSchema
        .extend({
          guestCount: z.number().int().min(1).max(6).optional(),
          guests: z
            .array(
              z.object({ name: z.string().trim().min(1).max(120), age: z.number().int().min(0).max(120).nullable() }),
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

      const booking = await loadBooking(parsed.data.bookingId);
      if (!booking) {
        res.status(404).json({ error: 'Booking not found' });
        return;
      }

      // Capacity check if guestCount is changing on a shared tour.
      if (parsed.data.guestCount && parsed.data.guestCount !== booking.guestCount) {
        if (booking.type === 'shared') {
          const tour = await getTourBySlug(booking.tourId);
          if (!tour) return badRequest(res, 'Tour record missing.');
          // Run a transactional capacity check that EXCLUDES this booking.
          try {
            await db.runTransaction(async (tx) => {
              const snap = await tx.get(
                db.collection('bookings').where('date', '==', booking.date),
              );
              const others = snap.docs
                .map((d) => d.data() as Booking)
                .filter(
                  (b) =>
                    b.id !== booking.id &&
                    b.timeSlot === booking.timeSlot &&
                    (b.status === 'pending-payment' || b.status === 'confirmed'),
                );
              const used = others.reduce((s, b) => s + b.guestCount, 0);
              if (used + parsed.data.guestCount! > tour.maxGuests) {
                throw new AvailabilityError(
                  'slot-shared-full',
                  `Cannot raise to ${parsed.data.guestCount} — only ${tour.maxGuests - used} spots free in this slot.`,
                );
              }
            });
          } catch (err) {
            if (err instanceof AvailabilityError) {
              res.status(409).json({ error: err.message, reason: err.reason });
              return;
            }
            throw err;
          }
        }
      }

      const patch: Record<string, unknown> = {
        updatedAt: FieldValue.serverTimestamp(),
      };
      const before: Record<string, unknown> = {};
      for (const key of [
        'guestCount',
        'guests',
        'customerName',
        'customerEmail',
        'customerPhone',
        'emergencyContactName',
        'emergencyContactPhone',
      ] as const) {
        const v = parsed.data[key];
        if (v !== undefined) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          before[key] = (booking as any)[key];
          patch[key] = v;
        }
      }
      if (Object.keys(patch).length === 1) {
        return badRequest(res, 'Nothing to update.');
      }

      await db.collection('bookings').doc(parsed.data.bookingId).update(patch);

      await writeAudit({
        admin,
        action: 'booking.update',
        targetId: parsed.data.bookingId,
        payload: { before, after: patch },
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
  { cors: false, secrets: COMMON_SECRETS, maxInstances: 5 },
  async (req, res) => {
    if (applyCors(req, res)) return;
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    try {
      const admin = await requireAdmin(req);
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

      if (parsed.data.notifyCustomer) {
        try {
          const refreshed = (await loadBooking(parsed.data.bookingId))!;
          const baseUrl = APP_BASE_URL.value();
          const { subject, html, text } = buildBookingConfirmation({
            booking: refreshed,
            baseUrl,
            marina: MARINA,
            phoneDisplay: PHONE_DISPLAY,
          });
          await getResend().emails.send({
            from: getFromAddress(),
            to: [refreshed.customerEmail],
            bcc: [admin.email],
            subject: `Updated: ${subject}`,
            html,
            text,
            replyTo: admin.email,
            headers: { 'X-Entity-Ref-ID': parsed.data.bookingId },
          });
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
  { cors: false, maxInstances: 5 },
  async (req, res) => {
    if (applyCors(req, res)) return;
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    try {
      const admin = await requireAdmin(req);
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
  { cors: false, maxInstances: 5 },
  async (req, res) => {
    if (applyCors(req, res)) return;
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    try {
      const admin = await requireAdmin(req);
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
        action: 'booking.update',
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
  { cors: false, secrets: COMMON_SECRETS, maxInstances: 5 },
  async (req, res) => {
    if (applyCors(req, res)) return;
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    try {
      const admin = await requireAdmin(req);
      const parsed = bookingIdSchema.safeParse(req.body);
      if (!parsed.success) return badRequest(res, 'Invalid input', parsed.error.format());

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


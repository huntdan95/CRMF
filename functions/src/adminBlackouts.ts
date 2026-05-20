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
import { buildCancellationEmail } from './lib/email-templates';
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

function handleAuthError(res: import('express').Response, err: unknown): boolean {
  if (err instanceof AdminAuthError) {
    res.status(err.status).json({ error: err.message });
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

// ===========================================================================
// adminCreateBlackout
// ===========================================================================
export const adminCreateBlackout = onRequest(
  {
    cors: false,
    secrets: [STRIPE_SECRET_KEY, RESEND_API_KEY, RESEND_FROM_EMAIL, APP_BASE_URL],
    maxInstances: 5,
  },
  async (req, res) => {
    if (applyCors(req, res)) return;
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    try {
      const admin = await requireAdmin(req);
      const parsed = z
        .object({
          date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          affectedSlots: z.array(z.enum(allSlotValues)).min(1),
          reason: z.enum(['weather', 'maintenance', 'personal', 'other']).optional(),
          notes: z.string().trim().max(500).optional(),
          cancelAffected: z.boolean().default(false),
        })
        .safeParse(req.body);
      if (!parsed.success) return badRequest(res, 'Invalid input', parsed.error.format());

      const ref = await db.collection('blackouts').add({
        date: parsed.data.date,
        affectedSlots: parsed.data.affectedSlots,
        reason: parsed.data.reason ?? null,
        notes: parsed.data.notes ?? null,
        createdAt: FieldValue.serverTimestamp(),
      });

      let cancelledIds: string[] = [];
      if (parsed.data.cancelAffected) {
        cancelledIds = await cancelAffectedBookings({
          date: parsed.data.date,
          slots: parsed.data.affectedSlots,
          adminEmail: admin.email,
        });
      }

      await writeAudit({
        admin,
        action: 'blackout.create',
        targetId: ref.id,
        payload: {
          date: parsed.data.date,
          affectedSlots: parsed.data.affectedSlots,
          reason: parsed.data.reason ?? null,
          cancelledBookingIds: cancelledIds,
        },
      });

      res.status(200).json({
        ok: true,
        blackoutId: ref.id,
        cancelledBookingIds: cancelledIds,
      });
    } catch (err) {
      if (handleAuthError(res, err)) return;
      serverError(res, err);
    }
  },
);

// ===========================================================================
// adminDeleteBlackout
// ===========================================================================
export const adminDeleteBlackout = onRequest(
  { cors: false, maxInstances: 5 },
  async (req, res) => {
    if (applyCors(req, res)) return;
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    try {
      const admin = await requireAdmin(req);
      const parsed = z
        .object({ blackoutId: z.string().min(1).max(64) })
        .safeParse(req.body);
      if (!parsed.success) return badRequest(res, 'Invalid input', parsed.error.format());

      await db.collection('blackouts').doc(parsed.data.blackoutId).delete();
      await writeAudit({
        admin,
        action: 'blackout.delete',
        targetId: parsed.data.blackoutId,
      });
      res.status(200).json({ ok: true });
    } catch (err) {
      if (handleAuthError(res, err)) return;
      serverError(res, err);
    }
  },
);

/**
 * Cancels every active booking on `date` that's in any of `slots` (or any
 * slot at all if `'all'` is included). Issues full refunds via Stripe and
 * sends cancellation emails. Best-effort: failures are logged but don't
 * roll back already-processed bookings.
 */
async function cancelAffectedBookings(opts: {
  date: string;
  slots: string[];
  adminEmail: string;
}): Promise<string[]> {
  const all = opts.slots.includes('all');
  const snap = await db
    .collection('bookings')
    .where('date', '==', opts.date)
    .get();

  const targets = snap.docs
    .map((d) => d.data() as Booking)
    .filter((b) =>
      (b.status === 'confirmed' || b.status === 'pending-payment') &&
      (all || opts.slots.includes(b.timeSlot)),
    );

  const cancelled: string[] = [];
  for (const booking of targets) {
    try {
      const owed = Math.max(
        0,
        booking.amountPaidCents - (booking.amountRefundedCents ?? 0),
      );

      if (owed > 0 && booking.stripePaymentIntentId) {
        await getStripe().refunds.create(
          {
            payment_intent: booking.stripePaymentIntentId,
            amount: owed,
            reason: 'requested_by_customer',
            metadata: {
              bookingId: booking.id,
              cancelledBy: 'admin',
              cause: 'blackout',
            },
          },
          { idempotencyKey: `blackout-cancel-${booking.id}` },
        );
      }

      await db.collection('bookings').doc(booking.id).update({
        status: 'cancelled',
        paymentStatus:
          owed === 0
            ? booking.paymentStatus
            : owed === booking.amountPaidCents
              ? 'refunded'
              : 'partial-refund',
        amountRefundedCents:
          (booking.amountRefundedCents ?? 0) + owed,
        cancellationReason: 'Day closed by Capt. Travis',
        cancelledAt: FieldValue.serverTimestamp(),
        cancelledBy: 'admin',
        updatedAt: FieldValue.serverTimestamp(),
      });

      try {
        const refreshed = (
          await db.collection('bookings').doc(booking.id).get()
        ).data() as Booking;
        const { subject, html, text } = buildCancellationEmail({
          booking: refreshed,
          refundCents: owed,
          refundPercent: 100,
          cancelledBy: 'admin',
          reason: 'Day closed by Capt. Travis (likely weather).',
          marina: MARINA,
          phoneDisplay: PHONE_DISPLAY,
        });
        await getResend().emails.send({
          from: getFromAddress(),
          to: [refreshed.customerEmail],
          bcc: [opts.adminEmail],
          subject,
          html,
          text,
          replyTo: opts.adminEmail,
          headers: { 'X-Entity-Ref-ID': booking.id },
        });
      } catch (err) {
        logger.error('Blackout cancellation email failed', { bookingId: booking.id, err });
      }

      cancelled.push(booking.id);
    } catch (err) {
      logger.error('Blackout cancellation failed', { bookingId: booking.id, err });
    }
  }

  return cancelled;
}

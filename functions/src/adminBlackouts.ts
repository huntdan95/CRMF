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
import { adminCancelOne } from './lib/admin-cancel';
import { WHOLE_DAY_OVERLAPS } from './lib/availability';
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

      let cascade: CascadeResult = { cancelled: [], failed: [] };
      if (parsed.data.cancelAffected) {
        cascade = await cancelAffectedBookings({
          date: parsed.data.date,
          slots: parsed.data.affectedSlots,
          reason: parsed.data.reason,
          adminEmail: admin.email,
        });
      }
      const cancelledIds = cascade.cancelled.map((c) => c.id);

      await writeAudit({
        admin,
        action: 'blackout.create',
        targetId: ref.id,
        payload: {
          date: parsed.data.date,
          affectedSlots: parsed.data.affectedSlots,
          reason: parsed.data.reason ?? null,
          cancelledBookingIds: cancelledIds,
          failedBookingIds: cascade.failed.map((f) => f.id),
        },
      });

      res.status(200).json({
        ok: true,
        blackoutId: ref.id,
        cancelledBookingIds: cancelledIds,
        cancelled: cascade.cancelled,
        failed: cascade.failed,
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

/** What customers are told when Travis closes a day. */
const CLOSURE_REASON: Record<string, string> = {
  weather: 'Closed for weather',
  maintenance: 'Closed for boat maintenance',
};

export interface CascadeResult {
  cancelled: Array<{ id: string; customerName: string; refundCents: number; manualRefundCents: number; emailed: boolean }>;
  failed: Array<{ id: string; customerName: string; error: string }>;
}

/**
 * Cancels every active booking on `date` in the closed slots (every slot if
 * `'all'` is included). A whole-day charter runs through the morning,
 * mid-morning and early-afternoon departures, so closing any of those
 * cancels it too. Each booking goes through adminCancelOne: Stripe refunds
 * where this site took the money, a note to refund by hand where the old
 * site did. One failure doesn't stop the rest; failures are reported back.
 */
async function cancelAffectedBookings(opts: {
  date: string;
  slots: string[];
  reason: string | undefined;
  adminEmail: string;
}): Promise<CascadeResult> {
  const all = opts.slots.includes('all');
  const closesWholeDay = opts.slots.some((s) => (WHOLE_DAY_OVERLAPS as readonly string[]).includes(s));
  const hit = (slot: string) =>
    all || opts.slots.includes(slot) || (slot === 'whole-day' && closesWholeDay);

  const snap = await db.collection('bookings').where('date', '==', opts.date).get();
  const targets = snap.docs
    .map((d) => ({ ...(d.data() as Booking), id: d.id }))
    .filter((b) => (b.status === 'confirmed' || b.status === 'pending-payment') && hit(b.timeSlot));

  const reason = CLOSURE_REASON[opts.reason ?? ''] ?? 'Capt. Travis had to close this day';
  const mailer = {
    marina: MARINA,
    phoneDisplay: PHONE_DISPLAY,
    async send({ to, subject, html, text, bookingId }: { to: string; subject: string; html: string; text: string; bookingId: string }) {
      await getResend().emails.send({
        from: getFromAddress(),
        to: [to],
        bcc: [opts.adminEmail],
        subject,
        html,
        text,
        replyTo: opts.adminEmail,
        headers: { 'X-Entity-Ref-ID': bookingId },
      });
    },
  };

  const result: CascadeResult = { cancelled: [], failed: [] };
  for (const booking of targets) {
    try {
      const outcome = await adminCancelOne(
        booking.id,
        { reason, notifyCustomer: true, cause: 'blackout' },
        { stripe: getStripe(), mailer },
      );
      if (outcome.kind === 'cancelled') {
        result.cancelled.push({
          id: booking.id,
          customerName: booking.customerName,
          refundCents: outcome.refundCents,
          manualRefundCents: outcome.manualRefundCents,
          emailed: outcome.emailed,
        });
      } else if (outcome.kind === 'paid-meanwhile') {
        result.failed.push({ id: booking.id, customerName: booking.customerName, error: 'They paid just now. Open the booking and cancel it there.' });
      } else if (outcome.kind !== 'already-cancelled') {
        result.failed.push({ id: booking.id, customerName: booking.customerName, error: outcome.kind });
      }
    } catch (err) {
      logger.error('Blackout cancellation failed', { bookingId: booking.id, err });
      result.failed.push({ id: booking.id, customerName: booking.customerName, error: 'Couldn’t cancel. Open the booking and cancel it there.' });
    }
  }
  return result;
}

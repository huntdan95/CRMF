import { onRequest } from 'firebase-functions/v2/https';
import { z } from 'zod';

import { RESEND_API_KEY, RESEND_FROM_EMAIL } from './lib/resend';
import { APP_BASE_URL, ADMIN_EMAIL } from './lib/config';
import { customerMailer } from './lib/customer-mailer';
import { buildClosureOfferEmail } from './lib/email-templates';
import { fixBouncedEmail, type ResendPaths } from './lib/fix-bounced-email';
import { fetchDayForecast } from './lib/forecast';
import { applyCors, badRequest, methodNotAllowed, serverError } from './lib/http';
import { AdminAuthError, requireAdmin, writeAudit } from './lib/admin-auth';
import { isEmailSendError, sendEmail } from './lib/email-log';
import { resendBookingConfirmation, sendUpdatedConfirmation } from './lib/send-confirmation';
import { resendTripPhotosEmail } from './lib/trip-photos';
import { reminderEmailFor } from './tourReminders';
import { sendPostTourFollowupEmail } from './postTourFollowup';
import { sendWaiverReminder } from './waiverReminder';

const schema = z.object({
  bookingId: z.string().min(1).max(64),
  customerEmail: z.string().trim().email().max(160),
});

/**
 * POST /adminFixBouncedEmail { bookingId, customerEmail }
 *
 * "Fix email and resend" on the booking page: saves the customer's new
 * address and sends each email that bounced again, where there's a way to
 * (lib/fix-bounced-email.ts). Answers with what went and what didn't, so
 * the page can say who to call. Admin site only; audit-logged.
 */
export const adminFixBouncedEmail = onRequest(
  { cors: false, secrets: [RESEND_API_KEY, RESEND_FROM_EMAIL, APP_BASE_URL], maxInstances: 5 },
  async (req, res) => {
    if (applyCors(req, res)) return;
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    try {
      const admin = await requireAdmin(req);
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return badRequest(res, 'That doesn’t look like an email address.', parsed.error.format());
      const { bookingId, customerEmail } = parsed.data;

      const outcome = await fixBouncedEmail(bookingId, customerEmail, { paths: resendPaths(admin.email) });
      switch (outcome.kind) {
        case 'not-found':
          res.status(404).json({ error: 'Booking not found' });
          return;
        case 'nothing-bounced':
          res.status(409).json({ error: 'No bounced emails on this booking. Reload the page to see where it stands.' });
          return;
        case 'same-address':
          return badRequest(res, `${outcome.address} bounced and won’t work. Ask them for a different address.`);
      }

      await writeAudit({
        admin,
        action: 'booking.update',
        targetId: bookingId,
        payload: {
          action: 'fix-bounced-email',
          before: { customerEmail: outcome.before },
          after: { customerEmail: outcome.after },
          results: outcome.results,
        },
      });
      res.status(200).json({ ok: true, customerEmail: outcome.after, results: outcome.results });
    } catch (err) {
      if (err instanceof AdminAuthError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      serverError(res, err);
    }
  },
);

/**
 * The real send paths. Each one is keyed on the bounced email's id, so a
 * double tap or a retry of the same fix doesn't send it twice.
 */
function resendPaths(adminEmail: string): ResendPaths {
  const baseUrl = () => APP_BASE_URL.value();
  /** A repeat of a key Resend has seen with a different email: it already went. */
  const once = async (send: () => Promise<unknown>) => {
    try {
      await send();
    } catch (err) {
      if (!isEmailSendError(err, 'invalid_idempotent_request')) throw err;
    }
  };
  return {
    confirmation: (b) => resendBookingConfirmation(b.id),
    updatedConfirmation: (b, bounce) =>
      once(() => sendUpdatedConfirmation(b, { adminEmail, idempotencyKey: `fix-bounce/${bounce.emailId}` })),
    async closureOffer(b, bounce) {
      const mailer = customerMailer({ adminEmail });
      const { subject, html, text } = buildClosureOfferEmail({
        booking: b,
        reason: b.closure!.reason,
        decideBy: b.closure!.decideBy,
        baseUrl: baseUrl(),
        phoneDisplay: mailer.phoneDisplay,
        marina: mailer.marina,
      });
      await once(() =>
        sendEmail({
          kind: 'closureOffer',
          bookingId: b.id,
          to: b.customerEmail,
          bcc: adminEmail,
          subject,
          html,
          text,
          replyTo: adminEmail,
          headers: { 'X-Entity-Ref-ID': b.id },
          idempotencyKey: `fix-bounce/${bounce.emailId}`,
        }),
      );
    },
    async reminder(b, bounce) {
      const { subject, html, text } = reminderEmailFor(b, baseUrl(), await fetchDayForecast(b.date));
      // Not copied to Travis, like the daily reminder.
      await once(() =>
        sendEmail({
          kind: 'reminder',
          bookingId: b.id,
          to: b.customerEmail,
          subject,
          html,
          text,
          replyTo: ADMIN_EMAIL.value(),
          headers: { 'X-Entity-Ref-ID': b.id, 'X-Email-Type': 'tour-reminder' },
          idempotencyKey: `fix-bounce/${bounce.emailId}`,
        }),
      );
    },
    async waiverReminder(b, bounce) {
      // Re-reads the booking, so it goes to the address just saved, with
      // who's still to sign as of now.
      try {
        return await sendWaiverReminder(b.id, { force: true, idempotencyKey: `fix-bounce/${bounce.emailId}` });
      } catch (err) {
        if (isEmailSendError(err, 'invalid_idempotent_request')) return { sent: true };
        throw err;
      }
    },
    async followup(b, bounce) {
      try {
        return await sendPostTourFollowupEmail(b.id, true, { idempotencyKey: `fix-bounce/${bounce.emailId}` });
      } catch (err) {
        if (isEmailSendError(err, 'invalid_idempotent_request')) return { sent: true };
        throw err;
      }
    },
    photos: (b, bounce) => resendTripPhotosEmail(b, { adminEmail, idempotencyKey: `fix-bounce/${bounce.emailId}` }),
  };
}

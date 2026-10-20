import { onRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { z } from 'zod';

import { APP_BASE_URL } from './lib/config';
import { RESEND_API_KEY, RESEND_FROM_EMAIL } from './lib/resend';
import { sendEmail } from './lib/email-log';
import { applyCors, badRequest, methodNotAllowed, serverError } from './lib/http';
import { AdminAuthError, requireAdmin, writeAudit } from './lib/admin-auth';
import { sendCrewCalendarLink } from './lib/crew-calendar';
import { buildCrewCalendarEmail } from './lib/crew-calendar-email';

/**
 * Admin → Crew → "Send calendar link": makes the crew member a new calendar
 * subscription link and emails it to them (lib/crew-calendar.ts). Their old
 * link stops working once the email has gone. Not open to the MCP token:
 * it hands out a feed of the schedule.
 */
export const adminSendCrewCalendarLink = onRequest(
  { cors: false, secrets: [RESEND_API_KEY, RESEND_FROM_EMAIL, APP_BASE_URL], maxInstances: 5 },
  async (req, res) => {
    if (applyCors(req, res)) return;
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    try {
      const admin = await requireAdmin(req);
      const parsed = z.object({ crewId: z.string().min(1).max(64) }).safeParse(req.body);
      if (!parsed.success) return badRequest(res, 'Invalid input', parsed.error.format());
      const { crewId } = parsed.data;

      const outcome = await sendCrewCalendarLink(
        { crewId, adminEmail: admin.email },
        {
          baseUrl: APP_BASE_URL.value(),
          async send({ to, name, httpsUrl, webcalUrl }) {
            const { subject, html, text } = buildCrewCalendarEmail({ name, httpsUrl, webcalUrl });
            // Not copied to Travis: the link is the key to the feed. Logged
            // as a crew email (the log keeps the address and subject, never
            // the body), so a bounce is recorded but doesn't alert.
            await sendEmail({
              kind: 'crew',
              crewId,
              to,
              subject,
              html,
              text,
              replyTo: admin.email,
              headers: { 'X-Entity-Ref-ID': `crew-calendar/${crewId}`, 'X-Email-Type': 'crew-calendar' },
            });
          },
        },
      );

      switch (outcome.kind) {
        case 'not-found':
        case 'removed-meanwhile':
          res.status(404).json({ error: 'They’re not on the crew any more.' });
          return;
        case 'no-email':
          res.status(409).json({ error: `Add ${outcome.name}’s email first. The link goes by email.` });
          return;
        case 'email-failed':
          logger.error('Crew calendar email failed', { crewId, error: outcome.error });
          res.status(502).json({ error: `Couldn’t email ${outcome.email}. Their old link, if they had one, still works. Try again in a minute.` });
          return;
        case 'sent':
          // Never the token or its hash.
          await writeAudit({
            admin,
            action: 'crew.calendar',
            targetId: crewId,
            payload: { name: outcome.name, email: outcome.email, by: 'admin', replacedLinks: outcome.replacedLinks },
          });
          res.status(200).json({ ok: true, email: outcome.email, replacedLinks: outcome.replacedLinks });
          return;
      }
    } catch (err) {
      if (err instanceof AdminAuthError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      serverError(res, err);
    }
  },
);

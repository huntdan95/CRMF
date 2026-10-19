import { onRequest } from 'firebase-functions/v2/https';

import { db } from './lib/firebase';
import { RESEND_API_KEY, RESEND_FROM_EMAIL, RESEND_WEBHOOK_SECRET } from './lib/resend';
import { APP_BASE_URL } from './lib/config';
import { handleResendWebhook } from './lib/email-events';
import { sendBounceAlert } from './lib/bounce-alert';

/**
 * Resend webhook endpoint.
 *
 * Configure in the Resend dashboard (Webhooks → Add endpoint) with the
 * deployed URL:
 *   https://<region>-<project>.cloudfunctions.net/resendWebhook
 * Events to subscribe:
 *   - email.delivered          (recorded on the email's log entry)
 *   - email.bounced            (flagged on the booking; Travis alerted, see lib/email-events.ts)
 *   - email.delivery_delayed   (Travis alerted if the trip is within 24 hours)
 *   - email.complained         (the booking gets `marketingSuppressed`; no alert)
 * Then store the endpoint's signing secret:
 *   firebase functions:secrets:set RESEND_WEBHOOK_SECRET
 *
 * Every request's Svix signature is checked against the raw body before
 * anything else; unsigned or wrongly signed requests get 400/401 and are
 * never processed. Each delivery is handled once (deduped on `svix-id`).
 */
export const resendWebhook = onRequest(
  {
    cors: false,
    secrets: [RESEND_WEBHOOK_SECRET, RESEND_API_KEY, RESEND_FROM_EMAIL, APP_BASE_URL],
    maxInstances: 10,
    invoker: 'public',
  },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.set('Allow', 'POST');
      res.status(405).send('Method not allowed');
      return;
    }
    // `req.rawBody` is populated by firebase-functions for HTTP triggers;
    // the signature is over these exact bytes, not the parsed JSON.
    const answer = await handleResendWebhook(
      { rawBody: req.rawBody, headers: req.headers },
      {
        db,
        secret: RESEND_WEBHOOK_SECRET.value(),
        sendAlert: (alert) => sendBounceAlert(alert),
      },
    );
    res.status(answer.status).json(answer.body);
  },
);

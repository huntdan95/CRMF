import webpush, { WebPushError } from 'web-push';
import { defineSecret } from 'firebase-functions/params';
import { logger } from 'firebase-functions/v2';

import { db } from './firebase';
import { ADMIN_EMAIL } from './config';

/**
 * Private half of the VAPID key pair that signs crew push notifications.
 * Set with: `firebase functions:secrets:set VAPID_PRIVATE_KEY`
 */
export const VAPID_PRIVATE_KEY = defineSecret('VAPID_PRIVATE_KEY');

/**
 * Public half of the pair. MUST match NEXT_PUBLIC_VAPID_PUBLIC_KEY in
 * apphosting.yaml: phones subscribe with that key, and push services reject
 * anything signed by a different pair.
 */
export const VAPID_PUBLIC_KEY =
  'BPQqtw9H_ODEjpQ4zaQnJV5kWOLf8ALuP8Zf_sJZx8kmBcuu3uHHVsCxmTVD6zhBwBt7m4tD4D5Yl0gSnCzkY3M';

/** What public/crew-sw.js turns into a notification. */
export interface CrewPush {
  title: string;
  body: string;
  /** Page to open when the notification is tapped. */
  url: string;
  /** Notifications with the same tag replace each other on the phone. */
  tag: string;
}

export interface CrewPushResult {
  sent: number;
  failed: number;
  /** Subscriptions the push service says are gone (app deleted, etc.). */
  removed: number;
}

/**
 * Sends a push to every phone a crew member has turned notifications on
 * for, or to one crew member's phones when `crewId` is given. Dead
 * subscriptions are deleted as they're found.
 */
export async function sendCrewPush(
  push: CrewPush,
  opts: { crewId?: string } = {},
): Promise<CrewPushResult> {
  const privateKey = VAPID_PRIVATE_KEY.value();
  if (!privateKey) {
    throw new Error(
      'VAPID_PRIVATE_KEY is not set. Run `firebase functions:secrets:set VAPID_PRIVATE_KEY`.',
    );
  }

  let query: FirebaseFirestore.Query = db.collection('crewPushSubscriptions');
  if (opts.crewId) query = query.where('crewId', '==', opts.crewId);
  const snap = await query.get();

  const payload = JSON.stringify(push);
  const result: CrewPushResult = { sent: 0, failed: 0, removed: 0 };

  await Promise.all(
    snap.docs.map(async (doc) => {
      const { endpoint, keys } = doc.data() as {
        endpoint: string;
        keys: { p256dh: string; auth: string };
      };
      try {
        await webpush.sendNotification({ endpoint, keys }, payload, {
          vapidDetails: {
            subject: `mailto:${ADMIN_EMAIL.value()}`,
            publicKey: VAPID_PUBLIC_KEY,
            privateKey,
          },
          // A booking notice is still worth delivering if the phone was off
          // for the evening; after a day it's stale.
          TTL: 60 * 60 * 24,
          urgency: 'high',
        });
        result.sent++;
      } catch (err) {
        if (
          err instanceof WebPushError &&
          (err.statusCode === 404 || err.statusCode === 410)
        ) {
          await doc.ref.delete();
          result.removed++;
          return;
        }
        result.failed++;
        logger.error('Crew push failed', {
          subscriptionId: doc.id,
          crewId: doc.get('crewId'),
          statusCode: err instanceof WebPushError ? err.statusCode : null,
          body: err instanceof WebPushError ? err.body : String(err),
        });
      }
    }),
  );

  return result;
}

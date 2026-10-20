import webpush, { WebPushError } from 'web-push';
import { defineSecret } from 'firebase-functions/params';
import { logger } from 'firebase-functions/v2';

import { db } from './firebase';
import { ADMIN_EMAIL } from './config';

/**
 * Private half of the VAPID key pair that signs push notifications, to the
 * crew app and to Travis's admin app.
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

/** What public/crew-sw.js and public/admin-sw.js turn into a notification. */
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
  /**
   * Subscriptions deleted because the push service says they're gone (app
   * deleted, etc.) or were made with a different VAPID key.
   */
  removed: number;
}

/**
 * Sends a push to every phone a crew member has turned notifications on
 * for, or to one crew member's phones when `crewId` is given. Dead
 * subscriptions are deleted as they're found.
 *
 * A 403 means the push service won't take our VAPID signature for that
 * subscription: the phone subscribed with an older key pair. Those are
 * deleted too, but only when another phone accepted the same signature in
 * this send. If none did, the likelier problem is our own key
 * (a wrong VAPID_PRIVATE_KEY), and deleting would wipe everyone's
 * notifications, so they're kept and logged. Either way, a phone holding
 * an old-key subscription swaps in a fresh one the next time the app opens
 * (src/components/crew/CrewNotifications.tsx).
 */
export async function sendCrewPush(
  push: CrewPush,
  opts: { crewId?: string } = {},
): Promise<CrewPushResult> {
  let query: FirebaseFirestore.Query = db.collection('crewPushSubscriptions');
  if (opts.crewId) query = query.where('crewId', '==', opts.crewId);
  return pushToAll((await query.get()).docs, push, 'Crew push');
}

/**
 * The same, to the phones and computers Travis (or another admin) turned
 * notifications on for in the admin app (`adminPushSubscriptions`, saved by
 * src/app/api/admin/push/route.ts), or to one admin's when `email` is given.
 */
export async function sendAdminPush(
  push: CrewPush,
  opts: { email?: string } = {},
): Promise<CrewPushResult> {
  let query: FirebaseFirestore.Query = db.collection('adminPushSubscriptions');
  if (opts.email) query = query.where('email', '==', opts.email);
  return pushToAll((await query.get()).docs, push, 'Admin push');
}

async function pushToAll(
  docs: FirebaseFirestore.QueryDocumentSnapshot[],
  push: CrewPush,
  label: string,
): Promise<CrewPushResult> {
  const privateKey = VAPID_PRIVATE_KEY.value().trim();
  if (!privateKey) {
    throw new Error(
      'VAPID_PRIVATE_KEY is not set. Run `firebase functions:secrets:set VAPID_PRIVATE_KEY`.',
    );
  }

  const payload = JSON.stringify(push);
  const result: CrewPushResult = { sent: 0, failed: 0, removed: 0 };
  const wrongKey: FirebaseFirestore.QueryDocumentSnapshot[] = [];

  await Promise.all(
    docs.map(async (doc) => {
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
        if (err instanceof WebPushError && err.statusCode === 403) {
          wrongKey.push(doc);
          return;
        }
        result.failed++;
        logger.error(`${label} failed`, {
          subscriptionId: doc.id,
          crewId: doc.get('crewId'),
          email: doc.get('email'),
          statusCode: err instanceof WebPushError ? err.statusCode : null,
          body: err instanceof WebPushError ? err.body : String(err),
        });
      }
    }),
  );

  if (wrongKey.length > 0 && result.sent > 0) {
    await Promise.all(wrongKey.map((doc) => doc.ref.delete()));
    result.removed += wrongKey.length;
  } else if (wrongKey.length > 0) {
    result.failed += wrongKey.length;
    logger.error(
      `${label} got 403s and no device accepted it; check that VAPID_PRIVATE_KEY pairs with VAPID_PUBLIC_KEY`,
      { subscriptionIds: wrongKey.map((d) => d.id) },
    );
  }

  return result;
}

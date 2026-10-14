import { onRequest } from 'firebase-functions/v2/https';
import { z } from 'zod';

import { db, FieldValue } from './lib/firebase';
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
import { hashCrewPassword } from './lib/crew-password';

function handleAuthError(res: import('express').Response, err: unknown): boolean {
  if (err instanceof AdminAuthError) {
    res.status(err.status).json({ error: err.message });
    return true;
  }
  return false;
}

/*
 * Crew = Travis's swim guides and mates. They sign in at /crew with the
 * email + password set here to see confirmed upcoming tours and get push
 * notifications for new bookings. The Next app does the sign-in check
 * (src/lib/crew-server.ts); these functions only manage the accounts.
 *
 *   crew/{crewId}                  name, email — admin-readable
 *   crewCredentials/{crewId}       password hash + lockout — server-only
 *   crewSessions/{tokenHash}       signed-in devices — server-only
 *   crewPushSubscriptions/{hash}   phones with notifications on
 *
 * Passwords never appear in the audit log.
 */

const passwordSchema = z.string().trim().min(8).max(128);

export const adminAddCrewMember = onRequest(
  { cors: false, maxInstances: 5 },
  async (req, res) => {
    if (applyCors(req, res)) return;
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    try {
      const admin = await requireAdmin(req);
      const parsed = z
        .object({
          name: z.string().trim().min(1).max(80),
          email: z.string().trim().toLowerCase().email().max(160),
          password: passwordSchema,
        })
        .safeParse(req.body);
      if (!parsed.success) return badRequest(res, 'Invalid input', parsed.error.format());
      const { name, email, password } = parsed.data;

      const passwordHash = await hashCrewPassword(password);
      const ref = db.collection('crew').doc();

      // Email is the sign-in name, so it has to be unique. The query read
      // inside the transaction makes two simultaneous adds collide.
      const created = await db.runTransaction(async (tx) => {
        const existing = await tx.get(
          db.collection('crew').where('email', '==', email).limit(1),
        );
        if (!existing.empty) return false;
        tx.set(ref, {
          name,
          email,
          createdAt: FieldValue.serverTimestamp(),
          createdBy: admin.email,
          passwordSetAt: FieldValue.serverTimestamp(),
          lastSignInAt: null,
        });
        tx.set(db.collection('crewCredentials').doc(ref.id), {
          passwordHash,
          failedAttempts: 0,
          lockedUntil: null,
        });
        return true;
      });
      if (!created) {
        res.status(409).json({ error: `${email} is already on the crew.` });
        return;
      }

      await writeAudit({
        admin,
        action: 'crew.add',
        targetId: ref.id,
        payload: { name, email },
      });

      res.status(200).json({ ok: true, id: ref.id });
    } catch (err) {
      if (handleAuthError(res, err)) return;
      serverError(res, err);
    }
  },
);

/**
 * Replaces a crew member's password and signs them out everywhere, so a
 * reset after a lost phone actually locks the old phone out.
 */
export const adminSetCrewPassword = onRequest(
  { cors: false, maxInstances: 5 },
  async (req, res) => {
    if (applyCors(req, res)) return;
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    try {
      const admin = await requireAdmin(req);
      const parsed = z
        .object({
          crewId: z.string().min(1).max(64),
          password: passwordSchema,
        })
        .safeParse(req.body);
      if (!parsed.success) return badRequest(res, 'Invalid input', parsed.error.format());
      const { crewId, password } = parsed.data;

      const crewRef = db.collection('crew').doc(crewId);
      const snap = await crewRef.get();
      if (!snap.exists) {
        res.status(404).json({ error: 'Crew member not found' });
        return;
      }

      const passwordHash = await hashCrewPassword(password);
      const sessions = await db
        .collection('crewSessions')
        .where('crewId', '==', crewId)
        .get();

      const batch = db.batch();
      batch.set(db.collection('crewCredentials').doc(crewId), {
        passwordHash,
        failedAttempts: 0,
        lockedUntil: null,
      });
      batch.update(crewRef, { passwordSetAt: FieldValue.serverTimestamp() });
      sessions.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();

      await writeAudit({
        admin,
        action: 'crew.password',
        targetId: crewId,
        payload: {
          name: snap.get('name'),
          email: snap.get('email'),
          signedOutDevices: sessions.size,
        },
      });

      res.status(200).json({ ok: true, signedOutDevices: sessions.size });
    } catch (err) {
      if (handleAuthError(res, err)) return;
      serverError(res, err);
    }
  },
);

/**
 * Removes a crew member: signs them out everywhere and stops their
 * notifications.
 */
export const adminRemoveCrewMember = onRequest(
  { cors: false, maxInstances: 5 },
  async (req, res) => {
    if (applyCors(req, res)) return;
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    try {
      const admin = await requireAdmin(req);
      const parsed = z
        .object({ crewId: z.string().min(1).max(64) })
        .safeParse(req.body);
      if (!parsed.success) return badRequest(res, 'Invalid input', parsed.error.format());
      const { crewId } = parsed.data;

      const crewRef = db.collection('crew').doc(crewId);
      const snap = await crewRef.get();
      if (!snap.exists) {
        res.status(404).json({ error: 'Crew member not found' });
        return;
      }

      const [sessions, subscriptions] = await Promise.all([
        db.collection('crewSessions').where('crewId', '==', crewId).get(),
        db.collection('crewPushSubscriptions').where('crewId', '==', crewId).get(),
      ]);

      const batch = db.batch();
      batch.delete(crewRef);
      batch.delete(db.collection('crewCredentials').doc(crewId));
      sessions.docs.forEach((d) => batch.delete(d.ref));
      subscriptions.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();

      await writeAudit({
        admin,
        action: 'crew.remove',
        targetId: crewId,
        payload: { before: { name: snap.get('name'), email: snap.get('email') } },
      });

      res.status(200).json({ ok: true });
    } catch (err) {
      if (handleAuthError(res, err)) return;
      serverError(res, err);
    }
  },
);

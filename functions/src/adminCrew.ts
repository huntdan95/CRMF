import { onRequest } from 'firebase-functions/v2/https';
import { z } from 'zod';

import { db, FieldValue } from './lib/firebase';
import { ADMIN_EMAIL } from './lib/config';
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
 * Crew = Travis and his swim guides and mates. Each one with an email and
 * alerts on gets the [CRMF] crew emails (lib/notify.ts). Anyone with an
 * email can also be given a password to sign in at /crew, where they see
 * confirmed upcoming tours and can turn on push notifications. The Next app
 * does that sign-in check (src/lib/crew-server.ts); these functions only
 * manage the people.
 *
 *   crew/{crewId}                  name, role, email, phone, alertsOn — admin-readable
 *   crewCredentials/{crewId}       password hash + lockout — server-only
 *   crewSessions/{tokenHash}       signed-in devices — server-only
 *   crewPushSubscriptions/{hash}   phones with notifications on
 *
 * Email is optional (Travis may not have it yet) but unique when set,
 * because it's the sign-in name. Phone is stored for a future text channel;
 * nothing sends to it yet. Passwords never appear in the audit log.
 */

const passwordSchema = z.string().trim().min(8).max(128);
const roleSchema = z.enum(['captain', 'mate']);
/** Empty string → null, so clearing a field in the form removes it. */
const optionalEmail = z
  .union([z.literal(''), z.string().trim().toLowerCase().email().max(160)])
  .nullable()
  .transform((v) => v || null);
const optionalPhone = z
  .string()
  .trim()
  .max(40)
  .nullable()
  .transform((v) => v || null);

/** True if someone other than `exceptId` already has this email. */
async function emailTaken(
  tx: FirebaseFirestore.Transaction,
  email: string,
  exceptId?: string,
): Promise<boolean> {
  const existing = await tx.get(db.collection('crew').where('email', '==', email).limit(2));
  return existing.docs.some((d) => d.id !== exceptId);
}

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
          role: roleSchema.default('mate'),
          email: optionalEmail.optional().default(null),
          phone: optionalPhone.optional().default(null),
          alertsOn: z.boolean().default(true),
          password: passwordSchema.optional(),
        })
        .refine((v) => !v.password || v.email, {
          message: 'Add their email to give them a password.',
          path: ['password'],
        })
        .safeParse(req.body);
      if (!parsed.success) return badRequest(res, 'Invalid input', parsed.error.format());
      const { name, role, email, phone, alertsOn, password } = parsed.data;

      const passwordHash = password ? await hashCrewPassword(password) : null;
      const ref = db.collection('crew').doc();

      // The email query inside the transaction makes two simultaneous adds
      // of the same address collide.
      const created = await db.runTransaction(async (tx) => {
        if (email && (await emailTaken(tx, email))) return false;
        tx.set(ref, {
          name,
          role,
          email,
          phone,
          alertsOn,
          createdAt: FieldValue.serverTimestamp(),
          createdBy: admin.email,
          passwordSetAt: passwordHash ? FieldValue.serverTimestamp() : null,
          lastSignInAt: null,
        });
        if (passwordHash) {
          tx.set(db.collection('crewCredentials').doc(ref.id), {
            passwordHash,
            failedAttempts: 0,
            lockedUntil: null,
          });
        }
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
        payload: { name, role, email, phone, alertsOn, appSignIn: !!passwordHash },
      });

      res.status(200).json({ ok: true, id: ref.id });
    } catch (err) {
      if (handleAuthError(res, err)) return;
      serverError(res, err);
    }
  },
);

/**
 * Changes a crew member's name, role, email, phone or alerts. Taking their
 * email away also takes away their app sign-in (it's their sign-in name),
 * so their password and signed-in phones are cleared too.
 */
export const adminUpdateCrewMember = onRequest(
  { cors: false, maxInstances: 5 },
  async (req, res) => {
    if (applyCors(req, res)) return;
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    try {
      const admin = await requireAdmin(req);
      const parsed = z
        .object({
          crewId: z.string().min(1).max(64),
          name: z.string().trim().min(1).max(80).optional(),
          role: roleSchema.optional(),
          email: optionalEmail.optional(),
          phone: optionalPhone.optional(),
          alertsOn: z.boolean().optional(),
        })
        .safeParse(req.body);
      if (!parsed.success) return badRequest(res, 'Invalid input', parsed.error.format());
      const { crewId, ...changes } = parsed.data;

      const crewRef = db.collection('crew').doc(crewId);
      const outcome = await db.runTransaction(async (tx) => {
        const snap = await tx.get(crewRef);
        if (!snap.exists) return { status: 'missing' as const };
        const before = snap.data() as Record<string, unknown>;
        if (changes.email && changes.email !== before.email && (await emailTaken(tx, changes.email, crewId))) {
          return { status: 'taken' as const };
        }
        const patch: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(changes)) {
          if (v !== undefined && v !== before[k]) patch[k] = v;
        }
        if (Object.keys(patch).length === 0) return { status: 'unchanged' as const };
        const losesSignIn = 'email' in patch && !patch.email;
        if (losesSignIn) patch.passwordSetAt = null;
        tx.update(crewRef, { ...patch, updatedAt: FieldValue.serverTimestamp() });
        if (losesSignIn) tx.delete(db.collection('crewCredentials').doc(crewId));
        return {
          status: 'updated' as const,
          name: before.name as string,
          losesSignIn,
          before: Object.fromEntries(Object.keys(patch).map((k) => [k, before[k] ?? null])),
          after: patch,
        };
      });

      if (outcome.status === 'missing') {
        res.status(404).json({ error: 'Crew member not found' });
        return;
      }
      if (outcome.status === 'taken') {
        res.status(409).json({ error: `${changes.email} is already on the crew.` });
        return;
      }
      if (outcome.status === 'unchanged') {
        res.status(200).json({ ok: true, unchanged: true });
        return;
      }

      let signedOutDevices = 0;
      if (outcome.losesSignIn) {
        const [sessions, subscriptions] = await Promise.all([
          db.collection('crewSessions').where('crewId', '==', crewId).get(),
          db.collection('crewPushSubscriptions').where('crewId', '==', crewId).get(),
        ]);
        const batch = db.batch();
        sessions.docs.forEach((d) => batch.delete(d.ref));
        subscriptions.docs.forEach((d) => batch.delete(d.ref));
        await batch.commit();
        signedOutDevices = sessions.size;
      }

      await writeAudit({
        admin,
        action: 'crew.update',
        targetId: crewId,
        payload: {
          name: (outcome.after.name ?? outcome.name) as string,
          before: outcome.before,
          after: outcome.after,
          signedOutDevices,
        },
      });

      res.status(200).json({ ok: true, signedOutDevices });
    } catch (err) {
      if (handleAuthError(res, err)) return;
      serverError(res, err);
    }
  },
);

/**
 * The crew as the owner gave it (2026-10-14): Capt. Travis, at the admin
 * email, plus mates Lacy, Faith and Megan. TODO(owner): the mates' emails;
 * until Travis adds them in Admin → Crew they get no alerts.
 */
function defaultCrew(adminEmail: string) {
  return [
    { name: 'Travis Urbin', role: 'captain', email: adminEmail.toLowerCase() },
    { name: 'Lacy', role: 'mate', email: null },
    { name: 'Faith', role: 'mate', email: null },
    { name: 'Megan', role: 'mate', email: null },
  ] as const;
}

/**
 * Fills an empty crew list with {@link defaultCrew}, alerts on. Does
 * nothing once anyone is on the crew, so a double tap can't duplicate them.
 */
export const adminSeedCrew = onRequest(
  { cors: false, maxInstances: 5 },
  async (req, res) => {
    if (applyCors(req, res)) return;
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    try {
      const admin = await requireAdmin(req);
      const crew = defaultCrew(ADMIN_EMAIL.value());
      const added = await db.runTransaction(async (tx) => {
        const existing = await tx.get(db.collection('crew').limit(1));
        if (!existing.empty) return [];
        return crew.map((member) => {
          const ref = db.collection('crew').doc();
          tx.set(ref, {
            ...member,
            phone: null,
            alertsOn: true,
            createdAt: FieldValue.serverTimestamp(),
            createdBy: admin.email,
            passwordSetAt: null,
            lastSignInAt: null,
          });
          return { id: ref.id, ...member };
        });
      });
      for (const member of added) {
        await writeAudit({
          admin,
          action: 'crew.add',
          targetId: member.id,
          payload: { name: member.name, role: member.role, email: member.email, alertsOn: true, seeded: true },
        });
      }
      res.status(200).json({ ok: true, added: added.length });
    } catch (err) {
      if (handleAuthError(res, err)) return;
      serverError(res, err);
    }
  },
);

/**
 * Sets or replaces a crew member's app password, signs them out everywhere
 * and stops their notifications, so a reset after a lost phone actually
 * locks the old phone out. Phones they sign back in on turn notifications
 * back on by themselves (CrewNotifications re-saves the subscription on
 * open). They need an email first: it's their sign-in name.
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
      if (!snap.get('email')) {
        res.status(409).json({ error: 'Add their email first. It’s what they sign in with.' });
        return;
      }

      const passwordHash = await hashCrewPassword(password);
      const [sessions, subscriptions] = await Promise.all([
        db.collection('crewSessions').where('crewId', '==', crewId).get(),
        db.collection('crewPushSubscriptions').where('crewId', '==', crewId).get(),
      ]);

      const batch = db.batch();
      batch.set(db.collection('crewCredentials').doc(crewId), {
        passwordHash,
        failedAttempts: 0,
        lockedUntil: null,
      });
      batch.update(crewRef, { passwordSetAt: FieldValue.serverTimestamp() });
      sessions.docs.forEach((d) => batch.delete(d.ref));
      subscriptions.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();

      await writeAudit({
        admin,
        action: 'crew.password',
        targetId: crewId,
        payload: {
          name: snap.get('name'),
          email: snap.get('email'),
          signedOutDevices: sessions.size,
          notificationsStopped: subscriptions.size,
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
 * Removes a crew member: stops their alerts, signs them out everywhere and
 * stops their push notifications.
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
        payload: {
          before: {
            name: snap.get('name'),
            role: snap.get('role') ?? null,
            email: snap.get('email') ?? null,
            phone: snap.get('phone') ?? null,
          },
        },
      });

      res.status(200).json({ ok: true });
    } catch (err) {
      if (handleAuthError(res, err)) return;
      serverError(res, err);
    }
  },
);

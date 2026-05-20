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

function handleAuthError(res: import('express').Response, err: unknown): boolean {
  if (err instanceof AdminAuthError) {
    res.status(err.status).json({ error: err.message });
    return true;
  }
  return false;
}

const SETTINGS_DOC = 'settings/site';

/**
 * Site-wide settings stored in `settings/site`. Phase 6 only handles
 * cancellation policy text + contact email; Phase 7 polish may add email
 * templates here too.
 */
export const adminUpdateSettings = onRequest(
  { cors: false, maxInstances: 5 },
  async (req, res) => {
    if (applyCors(req, res)) return;
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    try {
      const admin = await requireAdmin(req);
      const parsed = z
        .object({
          cancellationPolicyText: z.string().trim().max(4000).optional(),
          contactEmail: z.string().email().max(160).optional(),
        })
        .safeParse(req.body);
      if (!parsed.success) return badRequest(res, 'Invalid input', parsed.error.format());

      const ref = db.doc(SETTINGS_DOC);
      const snap = await ref.get();
      const before = snap.exists ? snap.data() : null;

      const patch: Record<string, unknown> = {
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: admin.email,
      };
      for (const key of ['cancellationPolicyText', 'contactEmail'] as const) {
        const v = parsed.data[key];
        if (v !== undefined) patch[key] = v;
      }
      if (Object.keys(patch).length === 2) {
        return badRequest(res, 'Nothing to update.');
      }

      await ref.set(patch, { merge: true });

      await writeAudit({
        admin,
        action: 'tour.update', // closest existing action; Phase 7 polish may add 'settings.update'
        targetId: 'site',
        payload: { before, after: patch },
      });

      res.status(200).json({ ok: true });
    } catch (err) {
      if (handleAuthError(res, err)) return;
      serverError(res, err);
    }
  },
);

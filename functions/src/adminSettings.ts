import { onRequest } from 'firebase-functions/v2/https';
import { z } from 'zod';

import { db, FieldValue } from './lib/firebase';
import {
  applyCors,
  badRequest,
  methodNotAllowed,
  serverError,
} from './lib/http';
import { APP_BASE_URL, MCP_TOKEN } from './lib/config';
import {
  requireAdmin,
  writeAudit,
  AdminAuthError,
} from './lib/admin-auth';
import { refreshSitePages } from './lib/site-refresh';
import { MAX_UNDO_MINUTES } from './lib/close-day';

function handleAuthError(res: import('express').Response, err: unknown): boolean {
  if (err instanceof AdminAuthError) {
    res.status(err.status).json({ error: err.message });
    return true;
  }
  return false;
}

const SETTINGS_DOC = 'settings/site';

/**
 * Site-wide settings stored in `settings/site`: the cancellation policy
 * text, the contact email, and how many minutes Travis has to undo
 * closing a day before anything goes out (`closureUndoMinutes`, 0 for no
 * wait; lib/close-day.ts).
 */
export const adminUpdateSettings = onRequest(
  { cors: false, secrets: [APP_BASE_URL, MCP_TOKEN], maxInstances: 5 },
  async (req, res) => {
    if (applyCors(req, res)) return;
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    try {
      const admin = await requireAdmin(req);
      const parsed = z
        .object({
          cancellationPolicyText: z.string().trim().max(4000).optional(),
          contactEmail: z.string().email().max(160).optional(),
          closureUndoMinutes: z.number().int().min(0).max(MAX_UNDO_MINUTES).optional(),
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
      for (const key of ['cancellationPolicyText', 'contactEmail', 'closureUndoMinutes'] as const) {
        const v = parsed.data[key];
        if (v !== undefined) patch[key] = v;
      }
      if (Object.keys(patch).length === 2) {
        return badRequest(res, 'Nothing to update.');
      }

      await ref.set(patch, { merge: true });

      await writeAudit({
        admin,
        action: 'settings.update',
        targetId: 'site',
        payload: { before, after: patch },
      });
      // Of these, only the policy text is on the site (/cancellation-policy).
      if (parsed.data.cancellationPolicyText !== undefined) await refreshSitePages();

      res.status(200).json({ ok: true });
    } catch (err) {
      if (handleAuthError(res, err)) return;
      serverError(res, err);
    }
  },
);

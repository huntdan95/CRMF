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

/** A list of wetsuit sizes as Travis types them: short, no repeats. */
const sizeList = z
  .array(z.string().trim().min(1).max(12))
  .min(1)
  .max(20)
  .refine((list) => new Set(list.map((s) => s.toLowerCase())).size === list.length, 'Each size once');

/**
 * Site-wide settings stored in `settings/site`: the cancellation policy
 * wording, the contact email, the Google review link the thank-you email
 * uses, and the wetsuit sizes guests pick from when they book. Everything
 * here is public (the booking form reads the sizes), so nothing private
 * belongs in it; the crew list lives in `crew/` (adminCrew.ts).
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
          googleReviewUrl: z
            .string()
            .trim()
            .max(500)
            .url()
            .refine((u) => u.startsWith('https://'), 'Use the https:// link')
            .optional(),
          wetsuitSizes: z.object({ adult: sizeList, kids: sizeList }).optional(),
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
      for (const key of [
        'cancellationPolicyText',
        'contactEmail',
        'googleReviewUrl',
        'wetsuitSizes',
      ] as const) {
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

      res.status(200).json({ ok: true });
    } catch (err) {
      if (handleAuthError(res, err)) return;
      serverError(res, err);
    }
  },
);

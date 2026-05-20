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
import type { SiteImageSlot } from './lib/types';

function handleAuthError(res: import('express').Response, err: unknown): boolean {
  if (err instanceof AdminAuthError) {
    res.status(err.status).json({ error: err.message });
    return true;
  }
  return false;
}

const VALID_SLOTS: readonly SiteImageSlot[] = [
  'hero',
  'pair',
  'greeting',
  'dappled',
  'group',
] as const;

const updateSchema = z.object({
  slot: z.enum(VALID_SLOTS as readonly [SiteImageSlot, ...SiteImageSlot[]]),
  storagePath: z.string().min(1).max(500),
  downloadUrl: z.string().url().max(1000),
  alt: z.string().trim().min(1).max(200),
  width: z.number().int().positive().max(20000).nullable(),
  height: z.number().int().positive().max(20000).nullable(),
});

const deleteSchema = z.object({
  slot: z.enum(VALID_SLOTS as readonly [SiteImageSlot, ...SiteImageSlot[]]),
});

/**
 * POST /adminUpdateSiteImage
 *
 * After uploading a file directly to Cloud Storage (browser → Storage via
 * the Firebase Storage SDK, which respects the admin-only write rule on
 * `public/*`), the admin client calls this function to persist the metadata
 * to Firestore at `siteImages/{slot}`. Marketing components read that doc
 * to swap the live photo.
 */
export const adminUpdateSiteImage = onRequest(
  { cors: false, maxInstances: 5 },
  async (req, res) => {
    if (applyCors(req, res)) return;
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    try {
      const admin = await requireAdmin(req);
      const parsed = updateSchema.safeParse(req.body);
      if (!parsed.success) {
        return badRequest(res, 'Invalid input', parsed.error.format());
      }

      const ref = db.collection('siteImages').doc(parsed.data.slot);
      await ref.set(
        {
          ...parsed.data,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: admin.email,
        },
        { merge: false },
      );

      await writeAudit({
        admin,
        action: 'siteImage.update',
        targetId: parsed.data.slot,
        payload: {
          storagePath: parsed.data.storagePath,
          width: parsed.data.width,
          height: parsed.data.height,
        },
      });

      res.status(200).json({ ok: true });
    } catch (err) {
      if (handleAuthError(res, err)) return;
      serverError(res, err);
    }
  },
);

/**
 * POST /adminDeleteSiteImage
 *
 * Clears the metadata so the slot falls back to its bundled placeholder.
 * The underlying Storage object is left in place — Travis can re-link it
 * later by re-uploading, or clean up via the Storage console.
 */
export const adminDeleteSiteImage = onRequest(
  { cors: false, maxInstances: 5 },
  async (req, res) => {
    if (applyCors(req, res)) return;
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    try {
      const admin = await requireAdmin(req);
      const parsed = deleteSchema.safeParse(req.body);
      if (!parsed.success) {
        return badRequest(res, 'Invalid input', parsed.error.format());
      }

      await db.collection('siteImages').doc(parsed.data.slot).delete();
      await writeAudit({
        admin,
        action: 'siteImage.delete',
        targetId: parsed.data.slot,
      });

      res.status(200).json({ ok: true });
    } catch (err) {
      if (handleAuthError(res, err)) return;
      serverError(res, err);
    }
  },
);

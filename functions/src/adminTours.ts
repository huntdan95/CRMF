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
import type { Tour } from './lib/types';

function handleAuthError(res: import('express').Response, err: unknown): boolean {
  if (err instanceof AdminAuthError) {
    res.status(err.status).json({ error: err.message });
    return true;
  }
  return false;
}

export const adminUpdateTour = onRequest(
  { cors: false, maxInstances: 5 },
  async (req, res) => {
    if (applyCors(req, res)) return;
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    try {
      const admin = await requireAdmin(req);
      const parsed = z
        .object({
          slug: z.string().regex(/^[a-z0-9-]+$/).min(1).max(64),
          name: z.string().trim().min(1).max(120).optional(),
          description: z.string().trim().min(1).max(4000).optional(),
          pricePerPerson: z.number().int().min(0).nullable().optional(),
          flatPrice: z.number().int().min(0).nullable().optional(),
          active: z.boolean().optional(),
          included: z.array(z.string().trim().min(1).max(200)).max(20).optional(),
        })
        .safeParse(req.body);
      if (!parsed.success) return badRequest(res, 'Invalid input', parsed.error.format());

      const ref = db.collection('tours').doc(parsed.data.slug);
      const snap = await ref.get();
      if (!snap.exists) {
        res.status(404).json({ error: 'Tour not found' });
        return;
      }

      const before = snap.data() as Tour;

      const patch: Record<string, unknown> = {
        updatedAt: FieldValue.serverTimestamp(),
      };
      for (const key of [
        'name',
        'description',
        'pricePerPerson',
        'flatPrice',
        'active',
        'included',
      ] as const) {
        const v = parsed.data[key];
        if (v !== undefined) patch[key] = v;
      }
      if (Object.keys(patch).length === 1) {
        return badRequest(res, 'Nothing to update.');
      }

      await ref.update(patch);

      await writeAudit({
        admin,
        action: 'tour.update',
        targetId: parsed.data.slug,
        payload: {
          before: pick(before as unknown as Record<string, unknown>, [
            'name',
            'description',
            'pricePerPerson',
            'flatPrice',
            'active',
            'included',
          ]),
          after: patch,
        },
      });

      res.status(200).json({ ok: true });
    } catch (err) {
      if (handleAuthError(res, err)) return;
      serverError(res, err);
    }
  },
);

function pick<T extends Record<string, unknown>, K extends keyof T>(
  obj: T,
  keys: readonly K[],
): Pick<T, K> {
  const out = {} as Pick<T, K>;
  for (const k of keys) out[k] = obj[k];
  return out;
}

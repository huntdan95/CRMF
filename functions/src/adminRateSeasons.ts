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

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const upsertSchema = z
  .object({
    id: z.string().min(1).max(64).optional(),
    name: z.string().trim().min(1).max(80),
    startDate: isoDate,
    endDate: isoDate,
    // Cents in the tour's unit. Stripe's minimum charge is $0.50.
    prices: z.record(
      z.string().regex(/^[a-z0-9-]+$/).max(64),
      z.number().int().min(50).max(10_000_000),
    ),
  })
  .refine((v) => v.endDate >= v.startDate, {
    message: 'The last day can’t be before the first day.',
    path: ['endDate'],
  })
  .refine((v) => Object.keys(v.prices).length > 0, {
    message: 'Set a price for at least one tour.',
    path: ['prices'],
  });

const deleteSchema = z.object({
  id: z.string().min(1).max(64),
});

/**
 * POST /adminUpsertRateSeason
 *
 * Create (omit `id`) or update (include `id`) a rate season: a date range
 * with its own prices, keyed by tour slug. Tours left out keep their
 * standard price. Read by checkout (createCheckoutSession) and the site.
 */
export const adminUpsertRateSeason = onRequest(
  { cors: false, maxInstances: 5 },
  async (req, res) => {
    if (applyCors(req, res)) return;
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    try {
      const admin = await requireAdmin(req);
      const parsed = upsertSchema.safeParse(req.body);
      if (!parsed.success) {
        const first = parsed.error.issues[0]?.message;
        return badRequest(res, first ?? 'Invalid input', parsed.error.format());
      }
      const input = parsed.data;

      const tourSnap = await db.collection('tours').get();
      const known = new Set(tourSnap.docs.map((d) => d.id));
      const unknown = Object.keys(input.prices).filter((slug) => !known.has(slug));
      if (unknown.length) {
        return badRequest(res, `Unknown tour: ${unknown.join(', ')}`);
      }

      const ref = input.id
        ? db.collection('rateSeasons').doc(input.id)
        : db.collection('rateSeasons').doc();
      const isNew = !input.id;
      const before = isNew ? null : (await ref.get()).data() ?? null;
      if (!isNew && !before) {
        res.status(404).json({ error: 'Season not found' });
        return;
      }

      const doc = {
        id: ref.id,
        name: input.name,
        startDate: input.startDate,
        endDate: input.endDate,
        prices: input.prices,
        updatedAt: FieldValue.serverTimestamp(),
        ...(isNew && { createdAt: FieldValue.serverTimestamp() }),
      };

      // Not merge: `prices` must be replaced whole so cleared tours drop out.
      await ref.set(isNew ? doc : { ...doc, createdAt: before!.createdAt ?? FieldValue.serverTimestamp() });

      await writeAudit({
        admin,
        action: 'rateSeason.upsert',
        targetId: ref.id,
        payload: {
          isNew,
          before: before && {
            name: before.name,
            startDate: before.startDate,
            endDate: before.endDate,
            prices: before.prices,
          },
          after: {
            name: input.name,
            startDate: input.startDate,
            endDate: input.endDate,
            prices: input.prices,
          },
        },
      });

      res.status(200).json({ ok: true, id: ref.id });
    } catch (err) {
      if (handleAuthError(res, err)) return;
      serverError(res, err);
    }
  },
);

/**
 * POST /adminDeleteRateSeason
 */
export const adminDeleteRateSeason = onRequest(
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
      const ref = db.collection('rateSeasons').doc(parsed.data.id);
      const before = (await ref.get()).data() ?? null;
      await ref.delete();
      await writeAudit({
        admin,
        action: 'rateSeason.delete',
        targetId: parsed.data.id,
        payload: { before },
      });
      res.status(200).json({ ok: true });
    } catch (err) {
      if (handleAuthError(res, err)) return;
      serverError(res, err);
    }
  },
);

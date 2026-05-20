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

const upsertSchema = z.object({
  id: z.string().min(1).max(64).optional(),
  quote: z.string().trim().min(1).max(2000),
  author: z.string().trim().min(1).max(160),
  location: z.string().trim().max(120).optional(),
  rating: z.number().int().min(1).max(5).optional(),
  source: z
    .enum(['google', 'tripadvisor', 'facebook', 'instagram', 'direct', 'other'])
    .default('direct'),
  sourceUrl: z.string().url().max(500).optional(),
  reviewedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  featured: z.boolean().default(false),
  published: z.boolean().default(true),
  order: z.number().int().min(0).max(10000).default(100),
});

const deleteSchema = z.object({
  id: z.string().min(1).max(64),
});

/**
 * POST /adminUpsertTestimonial
 *
 * Create (omit `id`) or update (include `id`) a testimonial. The function
 * normalizes optional fields to `null` so the Firestore doc shape is
 * predictable from the client side.
 */
export const adminUpsertTestimonial = onRequest(
  { cors: false, maxInstances: 5 },
  async (req, res) => {
    if (applyCors(req, res)) return;
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    try {
      const admin = await requireAdmin(req);
      const parsed = upsertSchema.safeParse(req.body);
      if (!parsed.success) {
        return badRequest(res, 'Invalid input', parsed.error.format());
      }
      const input = parsed.data;
      const ref = input.id
        ? db.collection('testimonials').doc(input.id)
        : db.collection('testimonials').doc();

      const isNew = !input.id;
      const before = isNew ? null : (await ref.get()).data();

      const doc = {
        id: ref.id,
        quote: input.quote,
        author: input.author,
        location: input.location ?? null,
        rating: input.rating ?? null,
        source: input.source,
        sourceUrl: input.sourceUrl ?? null,
        reviewedAt: input.reviewedAt ?? null,
        featured: input.featured,
        published: input.published,
        order: input.order,
        updatedAt: FieldValue.serverTimestamp(),
        ...(isNew && { createdAt: FieldValue.serverTimestamp() }),
      };

      await ref.set(doc, { merge: true });

      await writeAudit({
        admin,
        action: 'testimonial.upsert',
        targetId: ref.id,
        payload: { isNew, before, after: doc },
      });

      res.status(200).json({ ok: true, id: ref.id });
    } catch (err) {
      if (handleAuthError(res, err)) return;
      serverError(res, err);
    }
  },
);

/**
 * POST /adminDeleteTestimonial
 */
export const adminDeleteTestimonial = onRequest(
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
      await db.collection('testimonials').doc(parsed.data.id).delete();
      await writeAudit({
        admin,
        action: 'testimonial.delete',
        targetId: parsed.data.id,
      });
      res.status(200).json({ ok: true });
    } catch (err) {
      if (handleAuthError(res, err)) return;
      serverError(res, err);
    }
  },
);

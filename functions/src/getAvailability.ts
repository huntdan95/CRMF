import { onRequest } from 'firebase-functions/v2/https';
import { z } from 'zod';

import { db } from './lib/firebase';
import { listDayAvailability, listMonthBlackouts } from './lib/availability';
import {
  applyCors,
  badRequest,
  methodNotAllowed,
  serverError,
} from './lib/http';
import type { Tour } from './lib/types';

/**
 * GET /getAvailability?date=YYYY-MM-DD
 *   → { slots: SlotAvailability[] }
 *
 * GET /getAvailability?year=YYYY&month=M
 *   → { blackouts: string[] }  // YYYY-MM-DD list of fully-blocked dates
 *
 * Public, unauthenticated — only returns aggregate counts (no PII).
 */
export const getAvailability = onRequest(
  { cors: false, maxInstances: 10 },
  async (req, res) => {
    if (applyCors(req, res)) return;
    if (req.method !== 'GET') {
      methodNotAllowed(res, ['GET']);
      return;
    }

    const dateOnly = z
      .object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })
      .safeParse(req.query);

    if (dateOnly.success) {
      try {
        const toursSnap = await db
          .collection('tours')
          .where('active', '==', true)
          .get();
        const tours = toursSnap.docs.map((d) => d.data() as Tour);
        const slots = await listDayAvailability(dateOnly.data.date, tours);
        res.status(200).json({ slots });
        return;
      } catch (err) {
        serverError(res, err);
        return;
      }
    }

    const monthOnly = z
      .object({
        year: z.coerce.number().int().min(2024).max(2100),
        month: z.coerce.number().int().min(1).max(12),
      })
      .safeParse(req.query);

    if (monthOnly.success) {
      try {
        const blackouts = await listMonthBlackouts(
          monthOnly.data.year,
          monthOnly.data.month,
        );
        res.status(200).json({ blackouts });
        return;
      } catch (err) {
        serverError(res, err);
        return;
      }
    }

    badRequest(res, 'Provide ?date=YYYY-MM-DD or ?year=YYYY&month=M');
  },
);

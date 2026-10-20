import { onRequest } from 'firebase-functions/v2/https';
import { z } from 'zod';

import { isRealDate } from './lib/datetime';
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
import type { Tour } from './lib/types';

function handleAuthError(res: import('express').Response, err: unknown): boolean {
  if (err instanceof AdminAuthError) {
    res.status(err.status).json({ error: err.message });
    return true;
  }
  return false;
}

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Dates are written YYYY-MM-DD.')
  .refine(isRealDate, 'Not a real date');

/** A Firestore timestamp as the admin page reads it. */
const timestamp = z.object({ seconds: z.number().int(), nanoseconds: z.number().int() });

const upsertSchema = z
  .object({
    id: z.string().min(1).max(64).optional(),
    name: z
      .string()
      .trim()
      .min(1, 'Give the season a name.')
      .max(80, 'The name can be up to 80 characters.'),
    startDate: isoDate,
    endDate: isoDate,
    // Cents in the tour's unit. Stripe's minimum charge is $0.50.
    prices: z.record(
      z.string().regex(/^[a-z0-9-]+$/).max(64),
      z
        .number()
        .int()
        .min(50, 'Prices must be at least $0.50.')
        .max(10_000_000, 'Prices can be at most $100,000.'),
    ),
    /**
     * Editing: the season's `updatedAt` when the admin page loaded it (null
     * if it had none). The save replaces the whole season, so one changed
     * since (from MCP or another tab) is refused rather than silently put
     * back. MCP sends none: it replaces the price list by design.
     */
    expectedUpdatedAt: timestamp.nullable().optional(),
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
 * standard price. Read by checkout (createCheckoutSession) and the site,
 * whose pages are refreshed after each change (lib/site-refresh.ts).
 */
export const adminUpsertRateSeason = onRequest(
  { cors: false, secrets: [MCP_TOKEN, APP_BASE_URL], maxInstances: 5 },
  async (req, res) => {
    if (applyCors(req, res)) return;
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    try {
      const admin = await requireAdmin(req, { allowMcp: true });
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

      // Read and written in one transaction, so a change landing between
      // the version check and the save can't be written over either.
      const outcome = await db.runTransaction(async (tx) => {
        const before = isNew ? null : ((await tx.get(ref)).data() ?? null);
        if (!isNew && !before) return { kind: 'not-found' as const };
        if (!isNew && input.expectedUpdatedAt !== undefined && !sameTime(before!.updatedAt, input.expectedUpdatedAt)) {
          return { kind: 'changed' as const };
        }
        const doc = {
          id: ref.id,
          name: input.name,
          startDate: input.startDate,
          endDate: input.endDate,
          prices: input.prices,
          updatedAt: FieldValue.serverTimestamp(),
          createdAt: before?.createdAt ?? FieldValue.serverTimestamp(),
        };
        // Not merge: `prices` must be replaced whole so cleared tours drop out.
        tx.set(ref, doc);
        return { kind: 'saved' as const, before };
      });
      if (outcome.kind === 'not-found') {
        res.status(404).json({ error: 'Season not found' });
        return;
      }
      if (outcome.kind === 'changed') {
        res.status(409).json({
          error: 'This season was changed after you opened it (from Claude or another tab). Cancel, then Edit it again to see it as it is now.',
        });
        return;
      }
      const before = outcome.before;

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
      await refreshSitePages();

      const standard = Object.fromEntries(
        tourSnap.docs.map((d) => {
          const t = d.data() as Pick<Tour, 'type' | 'pricePerPerson' | 'flatPrice'>;
          return [d.id, (t.type === 'shared' ? t.pricePerPerson : t.flatPrice) ?? null];
        }),
      );
      res.status(200).json({
        ok: true,
        id: ref.id,
        priceChanges: seasonPriceChanges(before?.prices ?? null, input.prices, standard),
      });
    } catch (err) {
      if (handleAuthError(res, err)) return;
      serverError(res, err);
    }
  },
);

/** Two Firestore timestamps (or none) are the same moment. */
function sameTime(
  stored: unknown,
  expected: { seconds: number; nanoseconds: number } | null,
): boolean {
  const t = stored as { seconds?: unknown; nanoseconds?: unknown } | null | undefined;
  if (!t || typeof t.seconds !== 'number') return expected === null;
  return !!expected && t.seconds === expected.seconds && t.nanoseconds === expected.nanoseconds;
}

export interface SeasonPriceChange {
  tour: string;
  fromCents: number | null;
  toCents: number | null;
}

/**
 * What a save did to each tour's price on the season's dates: from its old
 * season price, or its standard price for a tour the season didn't price
 * before, to the new one (the standard price again for a tour taken out).
 * Unchanged tours are left out. MCP shows them to Claude, which raises one
 * that looks like a typo.
 */
export function seasonPriceChanges(
  before: Record<string, number> | null,
  after: Record<string, number>,
  standard: Record<string, number | null>,
): SeasonPriceChange[] {
  const tours = new Set([...Object.keys(before ?? {}), ...Object.keys(after)]);
  const changes: SeasonPriceChange[] = [];
  for (const tour of tours) {
    const fromCents = before?.[tour] ?? standard[tour] ?? null;
    const toCents = after[tour] ?? standard[tour] ?? null;
    if (fromCents !== toCents) changes.push({ tour, fromCents, toCents });
  }
  return changes;
}

/**
 * POST /adminDeleteRateSeason
 */
export const adminDeleteRateSeason = onRequest(
  { cors: false, secrets: [MCP_TOKEN, APP_BASE_URL], maxInstances: 5 },
  async (req, res) => {
    if (applyCors(req, res)) return;
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    try {
      const admin = await requireAdmin(req, { allowMcp: true });
      const parsed = deleteSchema.safeParse(req.body);
      if (!parsed.success) {
        return badRequest(res, parsed.error.issues[0]?.message ?? 'Invalid input', parsed.error.format());
      }
      const ref = db.collection('rateSeasons').doc(parsed.data.id);
      const before = (await ref.get()).data() ?? null;
      // A wrong id (MCP passing the season's name, say) mustn't answer "ok"
      // and log a delete while the season stays on sale.
      if (!before) {
        res.status(404).json({ error: 'Season not found' });
        return;
      }
      await ref.delete();
      await writeAudit({
        admin,
        action: 'rateSeason.delete',
        targetId: parsed.data.id,
        payload: { before },
      });
      await refreshSitePages();
      res.status(200).json({ ok: true });
    } catch (err) {
      if (handleAuthError(res, err)) return;
      serverError(res, err);
    }
  },
);

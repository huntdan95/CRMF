import { onRequest } from 'firebase-functions/v2/https';
import { z } from 'zod';

import { db, FieldValue } from './lib/firebase';
import {
  applyCors,
  badRequest,
  methodNotAllowed,
  serverError,
} from './lib/http';
import { MCP_TOKEN } from './lib/config';
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

/* -------------------------------------------------------------------------- */
/* Contact messages                                                            */
/* -------------------------------------------------------------------------- */

const contactStatusSchema = z.object({
  id: z.string().min(1).max(64),
  status: z.enum(['new', 'replied', 'archived']),
});

export const adminUpdateContactMessage = onRequest(
  { cors: false, secrets: [MCP_TOKEN], maxInstances: 5 },
  async (req, res) => {
    if (applyCors(req, res)) return;
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    try {
      const admin = await requireAdmin(req, { allowMcp: true });
      const parsed = contactStatusSchema.safeParse(req.body);
      if (!parsed.success) {
        return badRequest(res, 'Invalid input', parsed.error.format());
      }

      const ref = db.collection('contactMessages').doc(parsed.data.id);
      const snap = await ref.get();
      if (!snap.exists) {
        res.status(404).json({ error: 'Message not found' });
        return;
      }

      await ref.update({
        status: parsed.data.status,
        updatedAt: FieldValue.serverTimestamp(),
      });
      await writeAudit({
        admin,
        action: 'message.update',
        targetId: `contactMessage/${parsed.data.id}`,
        payload: { status: parsed.data.status, from: snap.get('name') ?? null },
      });

      res.status(200).json({ ok: true });
    } catch (err) {
      if (handleAuthError(res, err)) return;
      serverError(res, err);
    }
  },
);

/* -------------------------------------------------------------------------- */
/* Reschedule requests                                                         */
/* -------------------------------------------------------------------------- */

const rescheduleStatusSchema = z.object({
  id: z.string().min(1).max(64),
  status: z.enum(['open', 'accepted', 'declined', 'resolved']),
  notes: z.string().trim().max(2000).optional(),
});

export const adminUpdateRescheduleRequest = onRequest(
  { cors: false, secrets: [MCP_TOKEN], maxInstances: 5 },
  async (req, res) => {
    if (applyCors(req, res)) return;
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    try {
      const admin = await requireAdmin(req, { allowMcp: true });
      const parsed = rescheduleStatusSchema.safeParse(req.body);
      if (!parsed.success) {
        return badRequest(res, 'Invalid input', parsed.error.format());
      }

      const ref = db.collection('rescheduleRequests').doc(parsed.data.id);
      const snap = await ref.get();
      if (!snap.exists) {
        res.status(404).json({ error: 'Request not found' });
        return;
      }

      const patch: Record<string, unknown> = {
        status: parsed.data.status,
        updatedAt: FieldValue.serverTimestamp(),
      };
      if (parsed.data.notes !== undefined) {
        patch.adminNotes = parsed.data.notes;
      }
      await ref.update(patch);

      await writeAudit({
        admin,
        action: 'reschedule.update',
        targetId: `rescheduleRequest/${parsed.data.id}`,
        payload: { ...patch, bookingId: snap.get('bookingId') ?? null },
      });

      res.status(200).json({ ok: true });
    } catch (err) {
      if (handleAuthError(res, err)) return;
      serverError(res, err);
    }
  },
);

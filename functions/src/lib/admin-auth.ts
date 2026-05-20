import type { Request } from 'firebase-functions/v2/https';
import { getAuth } from 'firebase-admin/auth';
import { db, FieldValue } from './firebase';
import { ADMIN_EMAIL } from './config';
import type { AuditAction, AuditEntry } from './types';

export interface AdminContext {
  uid: string;
  email: string;
}

/**
 * Verifies that the calling request carries a Firebase ID token for the
 * configured admin email. Throws an `AdminAuthError` with the appropriate
 * HTTP status when not.
 */
export class AdminAuthError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'AdminAuthError';
  }
}

export async function requireAdmin(req: Request): Promise<AdminContext> {
  const auth = req.headers.authorization || req.headers.Authorization;
  const token = typeof auth === 'string' && auth.startsWith('Bearer ')
    ? auth.slice(7).trim()
    : null;
  if (!token) {
    throw new AdminAuthError('Missing Bearer token', 401);
  }

  const expectedEmail = ADMIN_EMAIL.value().toLowerCase();
  if (!expectedEmail) {
    throw new AdminAuthError('Admin email not configured', 500);
  }

  let decoded;
  try {
    decoded = await getAuth().verifyIdToken(token, true);
  } catch {
    throw new AdminAuthError('Invalid or expired token', 401);
  }

  if ((decoded.email ?? '').toLowerCase() !== expectedEmail) {
    throw new AdminAuthError('Not authorized', 403);
  }
  if (!decoded.email_verified) {
    throw new AdminAuthError('Email not verified', 403);
  }

  return { uid: decoded.uid, email: decoded.email! };
}

/**
 * Appends an audit-log entry. Every admin write should call this with a
 * before/after snapshot in the payload so Travis (or future-us) can replay
 * what changed and why.
 */
export async function writeAudit(opts: {
  admin: AdminContext;
  action: AuditAction;
  targetId: string;
  payload?: Record<string, unknown>;
}): Promise<void> {
  const entry: Omit<AuditEntry, 'id' | 'createdAt'> & {
    createdAt: FirebaseFirestore.FieldValue;
  } = {
    action: opts.action,
    actorEmail: opts.admin.email,
    targetId: opts.targetId,
    payload: opts.payload ?? {},
    createdAt: FieldValue.serverTimestamp(),
  };
  await db.collection('auditLog').add(entry);
}

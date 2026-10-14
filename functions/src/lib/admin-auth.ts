import { createHash, timingSafeEqual } from 'node:crypto';
import type { Request } from 'firebase-functions/v2/https';
import { getAuth } from 'firebase-admin/auth';
import { db, FieldValue } from './firebase';
import { ADMIN_EMAIL, MCP_TOKEN } from './config';
import type { AuditAction, AuditEntry } from './types';

export interface AdminContext {
  uid: string;
  /** Travis's email. Customer emails sent on his behalf copy and reply to it. */
  email: string;
  /** Set when the call came from the site's MCP endpoint, not the admin pages. */
  via?: 'mcp';
}

/** Shortest MCP_TOKEN accepted, so a placeholder value can't open admin. */
export const MCP_TOKEN_MIN_LENGTH = 32;

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

/**
 * `allowMcp` also accepts the MCP_TOKEN secret in place of an ID token. Only
 * pass it from endpoints that list MCP_TOKEN in their `secrets` and can't
 * move money.
 */
export async function requireAdmin(
  req: Request,
  opts: { allowMcp?: boolean } = {},
): Promise<AdminContext> {
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

  if (opts.allowMcp && mcpTokenMatches(token, MCP_TOKEN.value())) {
    return { uid: 'mcp', email: expectedEmail, via: 'mcp' };
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
 * Constant-time comparison of a presented bearer token with MCP_TOKEN.
 * False whenever the secret is unset or too short to be a real one.
 */
export function mcpTokenMatches(presented: string, expected: string | undefined): boolean {
  if (!expected || expected.length < MCP_TOKEN_MIN_LENGTH) return false;
  const digest = (v: string) => createHash('sha256').update(v).digest();
  return timingSafeEqual(digest(presented), digest(expected));
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
    ...(opts.admin.via && { via: opts.admin.via }),
    targetId: opts.targetId,
    payload: undefinedToNull(opts.payload ?? {}) as Record<string, unknown>,
    createdAt: FieldValue.serverTimestamp(),
  };
  await db.collection('auditLog').add(entry);
}

/**
 * Firestore rejects `undefined` anywhere in a document, and a "before"
 * snapshot is often a field that was never set (the first note on a
 * booking, say). Record those as null instead of failing the request after
 * the real write has already happened.
 */
function undefinedToNull(value: unknown): unknown {
  if (value === undefined) return null;
  if (Array.isArray(value)) return value.map(undefinedToNull);
  if (value && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, undefinedToNull(v)]),
    );
  }
  return value;
}

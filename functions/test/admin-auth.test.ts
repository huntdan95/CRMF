/**
 * The MCP token: accepted by the admin endpoints that opt in, refused by
 * everything that moves money. Run with `npm test` in functions/.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Request } from 'firebase-functions/v2/https';

import { AdminAuthError, mcpTokenMatches, requireAdmin } from '../src/lib/admin-auth';
import { adminCancelBooking, adminPartialRefund } from '../src/adminBookings';

const MCP = 'mcp-test-token-0123456789abcdefghijklmnop';

// Secrets and params are read from the environment when a request runs.
process.env.MCP_TOKEN = MCP;
process.env.ADMIN_EMAIL = 'travis@example.com';

const request = (token: string, body: Record<string, unknown> = {}) =>
  ({ method: 'POST', headers: { authorization: `Bearer ${token}` }, body, header: () => undefined }) as unknown as Request;

async function refused(promise: Promise<unknown>, status: number) {
  await assert.rejects(promise, (err: unknown) => err instanceof AdminAuthError && err.status === status);
}

/** Calls an endpoint the way Cloud Functions would and returns its answer. */
async function call(fn: (req: Request, res: never) => unknown, req: Request) {
  const answer = { status: 200, body: undefined as unknown };
  const res = {
    status(code: number) {
      answer.status = code;
      return res;
    },
    json(body: unknown) {
      answer.body = body;
      return res;
    },
    send(body: unknown) {
      answer.body = body;
      return res;
    },
    set: () => res,
    setHeader: () => res,
    getHeader: () => undefined,
    on: () => res,
  };
  await fn(req, res as never);
  return answer;
}

describe('MCP token', () => {
  test('stands in for Travis on an endpoint that allows it, marked as automation', async () => {
    const admin = await requireAdmin(request(MCP), { allowMcp: true });
    assert.deepEqual(admin, { uid: 'mcp', email: 'travis@example.com', via: 'mcp' });
  });

  test('is just an invalid ID token anywhere else', async () => {
    await refused(requireAdmin(request(MCP)), 401);
  });

  test('a wrong token is refused', async () => {
    await refused(requireAdmin(request(`${MCP}x`), { allowMcp: true }), 401);
  });

  test('a short or missing secret never matches, even itself', () => {
    assert.equal(mcpTokenMatches('short', 'short'), false);
    assert.equal(mcpTokenMatches('', undefined), false);
    assert.equal(mcpTokenMatches(MCP, MCP), true);
  });

  test('refunds and cancellations refuse it before touching anything', async () => {
    for (const endpoint of [adminCancelBooking, adminPartialRefund]) {
      const answer = await call(endpoint, request(MCP, { bookingId: 'b1', amountCents: 100 }));
      assert.equal(answer.status, 401);
      assert.deepEqual(answer.body, { error: 'Invalid or expired token' });
    }
  });
});

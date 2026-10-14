import { createHash, timingSafeEqual } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { createMcpServer } from '@/lib/mcp/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Shortest MCP_TOKEN accepted. Same floor as functions/src/lib/admin-auth.ts. */
const MCP_TOKEN_MIN_LENGTH = 32;

/**
 * POST /api/mcp — the site as an MCP server (Streamable HTTP, stateless,
 * JSON responses). Read-only lookups plus the admin edits that can't move
 * money; see src/lib/mcp/.
 *
 * Send MCP_TOKEN as `Authorization: Bearer <token>`. Clients that can't set
 * headers (claude.ai custom connectors) can use `/api/mcp?key=<token>`
 * instead.
 */
export async function POST(req: NextRequest): Promise<Response> {
  const denied = checkToken(req);
  if (denied) return denied;

  const server = createMcpServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    return await transport.handleRequest(req);
  } finally {
    await server.close();
  }
}

/** Stateless: no server-to-client stream to open, and no session to end. */
export function GET(): Response {
  return rpcError(405, 'Method not allowed.', { Allow: 'POST' });
}

export function DELETE(): Response {
  return rpcError(405, 'Method not allowed.', { Allow: 'POST' });
}

function checkToken(req: NextRequest): Response | null {
  const expected = process.env.MCP_TOKEN;
  if (!expected || expected.length < MCP_TOKEN_MIN_LENGTH) {
    return rpcError(503, 'The MCP endpoint isn’t set up on this site yet.');
  }
  const header = req.headers.get('authorization');
  const presented = header?.startsWith('Bearer ')
    ? header.slice(7).trim()
    : req.nextUrl.searchParams.get('key');
  if (!presented || !sameSecret(presented, expected)) {
    return rpcError(401, 'Unauthorized.', { 'WWW-Authenticate': 'Bearer realm="mcp"' });
  }
  return null;
}

function sameSecret(a: string, b: string): boolean {
  const digest = (v: string) => createHash('sha256').update(v).digest();
  return timingSafeEqual(digest(a), digest(b));
}

function rpcError(status: number, message: string, headers: Record<string, string> = {}): Response {
  return Response.json(
    { jsonrpc: '2.0', error: { code: -32000, message }, id: null },
    { status, headers: { 'Cache-Control': 'no-store', ...headers } },
  );
}

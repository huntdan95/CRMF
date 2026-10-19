import 'server-only';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { NextRequest } from 'next/server';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';

/** Shortest MCP_TOKEN accepted. Same floor as functions/src/lib/admin-auth.ts. */
const MCP_TOKEN_MIN_LENGTH = 32;

/** The full MCP_TOKEN, or null while it isn't set up. */
export function mcpToken(): string | null {
  const token = process.env.MCP_TOKEN;
  return token && token.length >= MCP_TOKEN_MIN_LENGTH ? token : null;
}

/**
 * The key for /api/mcp/blog, worked out from MCP_TOKEN so there's no second
 * secret to keep. It opens only the blog tools, and MCP_TOKEN can't be
 * recovered from it. Changing MCP_TOKEN changes it too.
 */
export function blogKey(token: string): string {
  return createHmac('sha256', token).update('crmf-blog-mcp').digest('base64url');
}

/**
 * Answers one MCP request (Streamable HTTP, stateless, JSON responses) if
 * it carries one of `keys`: as `Authorization: Bearer <key>`, or as
 * `?key=<key>` for clients that can't set headers (claude.ai and Grok
 * custom connectors).
 */
export async function serveMcp(req: NextRequest, keys: string[] | null, createServer: () => McpServer): Promise<Response> {
  if (!keys) return rpcError(503, 'The MCP endpoint isn’t set up on this site yet.');
  const header = req.headers.get('authorization');
  const presented = header?.startsWith('Bearer ') ? header.slice(7).trim() : req.nextUrl.searchParams.get('key');
  if (!presented || !keys.some((k) => sameSecret(presented, k))) {
    return rpcError(401, 'Unauthorized.', { 'WWW-Authenticate': 'Bearer realm="mcp"' });
  }

  const server = createServer();
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

function sameSecret(a: string, b: string): boolean {
  const digest = (v: string) => createHash('sha256').update(v).digest();
  return timingSafeEqual(digest(a), digest(b));
}

export function rpcError(status: number, message: string, headers: Record<string, string> = {}): Response {
  return Response.json(
    { jsonrpc: '2.0', error: { code: -32000, message }, id: null },
    { status, headers: { 'Cache-Control': 'no-store', ...headers } },
  );
}

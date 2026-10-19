import type { NextRequest } from 'next/server';
import { mcpToken, rpcError, serveMcp } from '@/lib/mcp/http';
import { createMcpServer } from '@/lib/mcp/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/mcp — the site as an MCP server (Streamable HTTP, stateless,
 * JSON responses). Read-only lookups, the admin edits that can't move
 * money, and the blog; see src/lib/mcp/.
 *
 * Send MCP_TOKEN as `Authorization: Bearer <token>`. Clients that can't set
 * headers (claude.ai custom connectors) can use `/api/mcp?key=<token>`
 * instead. Grokbot uses /api/mcp/blog, which opens only the blog tools.
 */
export async function POST(req: NextRequest): Promise<Response> {
  const token = mcpToken();
  return serveMcp(req, token ? [token] : null, createMcpServer);
}

/** Stateless: no server-to-client stream to open, and no session to end. */
export function GET(): Response {
  return rpcError(405, 'Method not allowed.', { Allow: 'POST' });
}

export function DELETE(): Response {
  return rpcError(405, 'Method not allowed.', { Allow: 'POST' });
}

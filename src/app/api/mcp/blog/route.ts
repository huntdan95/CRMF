import type { NextRequest } from 'next/server';
import { blogKey, mcpToken, rpcError, serveMcp } from '@/lib/mcp/http';
import { createBlogMcpServer } from '@/lib/mcp/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/mcp/blog — only the blog tools, for grokbot. Its key is
 * blogKey(MCP_TOKEN), shown in Admin → Blog, so grokbot never holds the
 * token that can edit bookings or close days. The full MCP_TOKEN works
 * here too.
 */
export async function POST(req: NextRequest): Promise<Response> {
  const token = mcpToken();
  return serveMcp(req, token ? [blogKey(token), token] : null, createBlogMcpServer);
}

export function GET(): Response {
  return rpcError(405, 'Method not allowed.', { Allow: 'POST' });
}

export function DELETE(): Response {
  return rpcError(405, 'Method not allowed.', { Allow: 'POST' });
}

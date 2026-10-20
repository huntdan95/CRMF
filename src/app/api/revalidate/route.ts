import { revalidatePath } from 'next/cache';
import type { NextRequest } from 'next/server';
import { mcpToken } from '@/lib/mcp/http';
import { isRevalidateKey } from '@/lib/revalidate-key';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

/**
 * POST /api/revalidate — the admin Cloud Functions call this right after
 * Travis changes a tour, a seasonal rate, a site photo, a review or the
 * cancellation policy, so the pages show it on their next visit instead of
 * when their 60-second refresh comes round. Takes
 * `Authorization: Bearer <revalidateKey(MCP_TOKEN)>`.
 *
 * It refreshes everything under the root layout, not a list of paths. The
 * tour catalog is read straight from Firestore (no fetch, so there are no
 * cache tags to name), and the (marketing) and (booking) layouts put it on
 * every page they render; the share image and the sitemap read it too. A
 * page renders again on its next visit, not all at once.
 *
 * This clears the cache of the server that answers. The 60-second refresh
 * stays as the backstop for anything this doesn't reach.
 */
export async function POST(req: NextRequest): Promise<Response> {
  const token = mcpToken();
  if (!token) return Response.json({ error: 'Not set up on this site yet.' }, { status: 503, headers: NO_STORE });
  const header = req.headers.get('authorization');
  const presented = header?.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!presented || !isRevalidateKey(presented, token)) {
    return Response.json({ error: 'Unauthorized.' }, { status: 401, headers: NO_STORE });
  }

  revalidatePath('/', 'layout');
  return Response.json({ ok: true }, { headers: NO_STORE });
}

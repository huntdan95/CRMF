import { NextResponse, type NextRequest } from 'next/server';
import { waiverPdfForSigner } from '@/lib/waiver/server';

export const runtime = 'nodejs';

interface RouteContext {
  params: Promise<{ id: string; waiverId: string }>;
}

/**
 * GET /waiver/{bookingId}/copy/{waiverId}?c={copyToken} — the signer's own
 * copy of their signed waiver. The token is shown once, on the success
 * screen; the emailed copy is an attachment instead.
 */
export async function GET(req: NextRequest, ctx: RouteContext): Promise<Response> {
  const { waiverId } = await ctx.params;
  const token = req.nextUrl.searchParams.get('c') ?? '';
  const copy = await waiverPdfForSigner(waiverId, token).catch((err) => {
    console.error('Waiver copy download failed:', err);
    return null;
  });
  if (!copy) return new NextResponse('Not found', { status: 404 });

  return new Response(new Uint8Array(copy.pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${copy.filename}"`,
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex',
    },
  });
}

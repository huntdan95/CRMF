import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/firebase/auth-server';
import { waiverPdfForAdmin } from '@/lib/waiver/server';

export const runtime = 'nodejs';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** GET /admin/waivers/{id}/pdf — a signed waiver, as signed. */
export async function GET(_req: Request, ctx: RouteContext): Promise<Response> {
  await requireAdmin();
  const { id } = await ctx.params;
  const copy = await waiverPdfForAdmin(id);
  if (!copy) return new NextResponse('Not found', { status: 404 });

  return new Response(new Uint8Array(copy.pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${copy.filename}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}

import { requireAdmin } from '@/lib/firebase/auth-server';
import { WAIVER_VERSION, waiverDocument } from '@/lib/waiver/agreement';
import { renderPaperWaiverPdf } from '@/lib/waiver/pdf';

export const runtime = 'nodejs';

/**
 * GET /admin/waivers/paper — the current waiver, blank, to print for the
 * dock: the same wording guests sign online, with the minor addendum.
 */
export async function GET(): Promise<Response> {
  await requireAdmin();
  const pdf = await renderPaperWaiverPdf(waiverDocument({ withMinors: true }));
  return new Response(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="waiver-paper-${WAIVER_VERSION}.pdf"`,
      'Cache-Control': 'private, no-store',
    },
  });
}

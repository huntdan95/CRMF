import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase/admin';
import { requireAdmin } from '@/lib/firebase/auth-server';
import { renderManifestPdf } from '@/lib/manifest-pdf';
import type { Booking } from '@/lib/firebase/types';
import { tours } from '@/lib/tours';

export const runtime = 'nodejs';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(
  _req: Request,
  ctx: RouteContext,
): Promise<Response> {
  await requireAdmin();
  const { id } = await ctx.params;

  const snap = await adminDb().collection('bookings').doc(id).get();
  if (!snap.exists) {
    return new NextResponse('Not found', { status: 404 });
  }
  const booking = snap.data() as Booking;
  const tour = tours.find((t) => t.slug === booking.tourId);

  const pdfBuffer = await renderManifestPdf({
    booking,
    tour: tour
      ? {
          startTimeDisplay: tour.startTimeDisplay,
          endTimeDisplay: tour.endTimeDisplay,
        }
      : null,
  });

  return new Response(new Uint8Array(pdfBuffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="manifest-${id}.pdf"`,
    },
  });
}

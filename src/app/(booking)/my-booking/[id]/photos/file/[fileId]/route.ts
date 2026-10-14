import { NextResponse, type NextRequest } from 'next/server';
import { galleryFile } from '@/lib/trip-photos-server';
import { attachment, storageStream } from '@/lib/trip-photo-download';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /my-booking/<id>/photos/file/<fileId>?t=<accessToken>
 *
 * One photo or video from the guest's gallery, as a download.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string; fileId: string }> }) {
  const { id, fileId } = await params;
  const token = req.nextUrl.searchParams.get('t') ?? '';
  const file = await galleryFile(id, token, fileId).catch(() => null);
  if (!file) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return new Response(storageStream(file.storagePath), {
    headers: {
      'Content-Type': file.contentType || 'application/octet-stream',
      ...(file.size ? { 'Content-Length': String(file.size) } : {}),
      'Content-Disposition': attachment(file.name),
      'Cache-Control': 'private, no-store',
      'Referrer-Policy': 'no-referrer',
    },
  });
}

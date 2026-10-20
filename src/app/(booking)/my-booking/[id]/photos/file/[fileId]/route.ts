import { NextResponse, type NextRequest } from 'next/server';
import { DIRECT_DOWNLOAD_BYTES, galleryFile } from '@/lib/trip-photos-server';
import { attachment, fetchStored } from '@/lib/trip-photo-download';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /my-booking/<id>/photos/file/<fileId>?k=<gallery key> (or ?t=<accessToken>)
 *
 * One photo or video from the guest's gallery, as a download. A video or
 * big file that Storage hands out as an attachment (`attachment`) downloads
 * straight from Storage instead, as the gallery links it; older ones still
 * come through here.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string; fileId: string }> }) {
  const { id, fileId } = await params;
  const { searchParams } = req.nextUrl;
  const cred = { key: searchParams.get('k'), token: searchParams.get('t') };
  const file = await galleryFile(id, cred, fileId).catch(() => null);
  if (!file) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  let stored: Response;
  try {
    stored = await fetchStored(file.url);
  } catch (err) {
    console.error('Trip photo download failed:', err);
    return NextResponse.json({ error: 'That file isn’t available right now. Try again in a minute.' }, { status: 502 });
  }
  return new Response(stored.body, {
    headers: {
      'Content-Type': file.contentType || 'application/octet-stream',
      // Cloud Run won't send a response over 32 MiB that says its length,
      // so a bigger one goes without (chunked) and isn't cut off. A photo
      // keeps it, for the browser's progress bar.
      ...(file.size && file.size <= DIRECT_DOWNLOAD_BYTES ? { 'Content-Length': String(file.size) } : {}),
      'Content-Disposition': attachment(file.name),
      'Cache-Control': 'private, no-store',
      'Referrer-Policy': 'no-referrer',
    },
  });
}

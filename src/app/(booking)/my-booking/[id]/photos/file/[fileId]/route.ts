import { NextResponse, type NextRequest } from 'next/server';
import { galleryFile } from '@/lib/trip-photos-server';
import { attachment, fetchStored } from '@/lib/trip-photo-download';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /my-booking/<id>/photos/file/<fileId>?k=<gallery key> (or ?t=<accessToken>)
 *
 * One photo or video from the guest's gallery, as a download.
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
      ...(file.size ? { 'Content-Length': String(file.size) } : {}),
      'Content-Disposition': attachment(file.name),
      'Cache-Control': 'private, no-store',
      'Referrer-Policy': 'no-referrer',
    },
  });
}

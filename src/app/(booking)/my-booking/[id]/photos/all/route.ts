import { PassThrough, Readable } from 'node:stream';
import archiver from 'archiver';
import { NextResponse, type NextRequest } from 'next/server';
import { adminStorage } from '@/lib/firebase/admin';
import { galleryStoragePaths, storageBucketName } from '@/lib/trip-photos-server';
import { attachment, uniqueNames } from '@/lib/trip-photo-download';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * A stream that opens its source only when the zip gets to it, so a trip
 * with 80 files doesn't start 80 downloads from Storage at once.
 */
function lazy(open: () => Readable): Readable {
  let source: Readable | null = null;
  const stream: Readable = new Readable({
    read() {
      if (source) {
        source.resume();
        return;
      }
      source = open();
      source.on('data', (chunk) => {
        if (!stream.push(chunk)) source!.pause();
      });
      source.on('end', () => stream.push(null));
      source.on('error', (err) => stream.destroy(err));
    },
  });
  return stream;
}

/**
 * GET /my-booking/<id>/photos/all?t=<accessToken>
 *
 * Every photo and video from the guest's departure in one zip, streamed as
 * it's built. Stored, not compressed: photos and videos are compressed
 * already, and it starts downloading straight away.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = req.nextUrl.searchParams.get('t') ?? '';
  const found = await galleryStoragePaths(id, token).catch(() => null);
  if (!found || found.files.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const bucket = adminStorage().bucket(storageBucketName());
  const zip = archiver('zip', { store: true });
  const out = new PassThrough();
  zip.on('warning', (err) => console.warn('Zip warning:', err));
  zip.on('error', (err) => {
    console.error('Zip failed:', err);
    out.destroy(err);
  });
  zip.pipe(out);

  const names = uniqueNames(found.files.map((f) => f.name));
  found.files.forEach((f, i) => {
    zip.append(
      lazy(() => bucket.file(f.storagePath).createReadStream()),
      { name: names[i]! },
    );
  });
  void zip.finalize();

  return new Response(Readable.toWeb(out) as ReadableStream<Uint8Array>, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': attachment(`manatee-tour-photos-${found.gallery.date}.zip`),
      'Cache-Control': 'private, no-store',
      'Referrer-Policy': 'no-referrer',
    },
  });
}

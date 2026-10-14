import { PassThrough, Readable } from 'node:stream';
import type { ReadableStream as NodeWebStream } from 'node:stream/web';
import archiver from 'archiver';
import { NextResponse, type NextRequest } from 'next/server';
import { galleryForBooking } from '@/lib/trip-photos-server';
import { attachment, fetchStored, uniqueNames } from '@/lib/trip-photo-download';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * A stream that fetches its file only when the zip gets to it, so a trip
 * with 80 files doesn't start 80 downloads from Storage at once.
 */
function lazy(url: string): Readable {
  let source: Readable | null = null;
  let opening = false;
  const stream: Readable = new Readable({
    read() {
      if (source) {
        source.resume();
        return;
      }
      if (opening) return;
      opening = true;
      fetchStored(url).then(
        (res) => {
          source = Readable.fromWeb(res.body as unknown as NodeWebStream<Uint8Array>);
          source.on('data', (chunk) => {
            if (!stream.push(chunk)) source!.pause();
          });
          source.on('end', () => stream.push(null));
          source.on('error', (err) => stream.destroy(err));
        },
        (err) => stream.destroy(err),
      );
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
  const gallery = await galleryForBooking(id, token).catch(() => null);
  if (!gallery || gallery.files.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const zip = archiver('zip', { store: true });
  const out = new PassThrough();
  zip.on('warning', (err) => console.warn('Zip warning:', err));
  zip.on('error', (err) => {
    console.error('Zip failed:', err);
    out.destroy(err);
  });
  zip.pipe(out);

  const names = uniqueNames(gallery.files.map((f) => f.name));
  gallery.files.forEach((f, i) => zip.append(lazy(f.url), { name: names[i]! }));
  void zip.finalize();

  return new Response(Readable.toWeb(out) as ReadableStream<Uint8Array>, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': attachment(`manatee-tour-photos-${gallery.date}.zip`),
      'Cache-Control': 'private, no-store',
      'Referrer-Policy': 'no-referrer',
    },
  });
}

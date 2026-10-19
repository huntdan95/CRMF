import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getCrewMember } from '@/lib/crew-server';
import { marinaNow } from '@/lib/availability';
import { hostFromHeaders } from '@/lib/host';
import { DriveError, isDriveConfigured, startResumableUpload } from '@/lib/google-drive';
import {
  GUESTS_FILE_NAME,
  READY_FILE_NAME,
  ensureTripFolder,
  isUploadableTrip,
  markTripReady,
  parseTripId,
  recordUploads,
} from '@/lib/trip-photos-server';

export const runtime = 'nodejs';

const MAX_FILE_BYTES = 5 * 1024 ** 3; // 5 GB — plenty for a GoPro clip

const bodySchema = z.discriminatedUnion('action', [
  // Start uploads: returns one Google upload URL per file, in order.
  z.object({
    action: z.literal('start'),
    tripId: z.string().max(40),
    files: z
      .array(
        z.object({
          name: z.string().trim().min(1).max(200),
          mimeType: z.string().regex(/^(image|video)\/[\w.+-]+$/, 'Photos and videos only'),
          size: z.number().int().min(1).max(MAX_FILE_BYTES),
        }),
      )
      .min(1)
      .max(50),
  }),
  // A file finished uploading.
  z.object({
    action: z.literal('uploaded'),
    tripId: z.string().max(40),
    count: z.number().int().min(1).max(50),
  }),
  // "Photos are all in" — tells grokbot it can send them.
  z.object({
    action: z.literal('ready'),
    tripId: z.string().max(40),
  }),
]);

/**
 * Drive file names can't usefully contain path separators, and an upload
 * mustn't take the name of a file grokbot acts on (the guest list or the
 * ready-to-send marker).
 */
function safeName(name: string): string {
  const clean = name.replace(/[\\/]/g, '-');
  const lower = clean.toLowerCase();
  return lower === GUESTS_FILE_NAME.toLowerCase() || lower === READY_FILE_NAME.toLowerCase()
    ? `upload-${clean}`
    : clean;
}

/**
 * POST /api/crew/photos
 *
 * Trip-photo uploads from the crew app. Photos go straight from the phone
 * to Google Drive; this route only hands out upload URLs and keeps count.
 * See src/lib/trip-photos-server.ts for the Drive layout.
 */
export async function POST(req: NextRequest) {
  const member = await getCrewMember();
  if (!member) {
    return NextResponse.json({ error: 'Signed out' }, { status: 401 });
  }
  if (!isDriveConfigured()) {
    return NextResponse.json(
      { error: 'Photo uploads aren’t connected to Google Drive yet. Let Travis know.' },
      { status: 503 },
    );
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid request' },
      { status: 400 },
    );
  }
  const body = parsed.data;
  if (!parseTripId(body.tripId)) {
    return NextResponse.json({ error: 'Unknown trip' }, { status: 400 });
  }

  try {
    // Counting uploads too: otherwise any crew session could make up a
    // tripPhotos doc, and a photo count, for any date and slot.
    if (!(await isUploadableTrip(body.tripId, marinaNow()))) {
      return NextResponse.json(
        { error: 'That trip isn’t open for photos (only the last week’s trips are).' },
        { status: 400 },
      );
    }

    if (body.action === 'uploaded') {
      await recordUploads(body.tripId, body.count, member.name);
      return NextResponse.json({ ok: true });
    }

    if (body.action === 'ready') {
      await markTripReady(body.tripId, member.name);
      return NextResponse.json({ ok: true });
    }

    // The phone PUTs each file to Google itself, and Google only lets it
    // if the upload was started for this page's origin.
    const origin = req.headers.get('origin');
    if (!origin || !URL.canParse(origin) || new URL(origin).hostname !== hostFromHeaders(req.headers)) {
      return NextResponse.json({ error: 'Bad origin' }, { status: 400 });
    }

    const folderId = await ensureTripFolder(body.tripId);
    const uploadUrls = await Promise.all(
      body.files.map((file) =>
        startResumableUpload({
          name: safeName(file.name),
          parentId: folderId,
          mimeType: file.mimeType,
          size: file.size,
          origin,
        }),
      ),
    );
    return NextResponse.json({ uploadUrls });
  } catch (err) {
    console.error('Crew photo request failed:', err);
    const reconnect = err instanceof DriveError && /token refresh/i.test(err.message);
    return NextResponse.json(
      {
        error: reconnect
          ? 'Google Drive needs reconnecting. Let Travis know.'
          : 'Couldn’t reach Google Drive. Try again in a minute.',
      },
      { status: 502 },
    );
  }
}

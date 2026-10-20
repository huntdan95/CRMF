import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase/admin';
import { getCrewMember, sha256 } from '@/lib/crew-server';
import { isPushServiceEndpoint } from '@/lib/push-endpoint';

export const runtime = 'nodejs';

/**
 * POST /api/crew/push
 *
 * Body: a PushSubscription's toJSON(). Saves (or refreshes) this phone's
 * subscription for the signed-in crew member. Keyed by the endpoint's hash,
 * so re-saving the same phone is a no-op.
 */
export async function POST(req: NextRequest) {
  const member = await getCrewMember();
  if (!member) {
    return NextResponse.json({ error: 'Signed out' }, { status: 401 });
  }

  const parsed = z
    .object({
      endpoint: z.string().max(2000),
      keys: z.object({
        p256dh: z.string().min(1).max(200),
        auth: z.string().min(1).max(100),
      }),
    })
    .safeParse(await req.json().catch(() => null));
  if (!parsed.success || !isPushServiceEndpoint(parsed.data.endpoint)) {
    return NextResponse.json({ error: 'Invalid subscription' }, { status: 400 });
  }

  const { endpoint, keys } = parsed.data;
  await adminDb()
    .collection('crewPushSubscriptions')
    .doc(sha256(endpoint))
    .set({
      crewId: member.id,
      endpoint,
      keys,
      userAgent: req.headers.get('user-agent')?.slice(0, 300) ?? null,
      savedAt: FieldValue.serverTimestamp(),
    });
  return NextResponse.json({ ok: true });
}

/**
 * DELETE /api/crew/push
 *
 * Body: { endpoint: string }. Turns notifications off for this phone.
 */
export async function DELETE(req: NextRequest) {
  const member = await getCrewMember();
  if (!member) {
    return NextResponse.json({ error: 'Signed out' }, { status: 401 });
  }

  const parsed = z
    .object({ endpoint: z.string().max(2000) })
    .safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'endpoint required' }, { status: 400 });
  }

  const ref = adminDb()
    .collection('crewPushSubscriptions')
    .doc(sha256(parsed.data.endpoint));
  const snap = await ref.get();
  if (snap.exists && snap.get('crewId') === member.id) await ref.delete();
  return NextResponse.json({ ok: true });
}
